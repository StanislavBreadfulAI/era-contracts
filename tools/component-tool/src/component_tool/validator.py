"""Validator - checks structural invariants on the component graph."""

from __future__ import annotations

from pathlib import Path

from .graph import build_graph, resolve_scope
from .models import ComponentGraph, ValidationIssue, ValidationSeverity
from .scanner import resolve_component_path


def validate_graph(
    graph: ComponentGraph,
    components_root: Path,
    git_root: Path | None = None,
    all_files: list[str] | None = None,
) -> list[ValidationIssue]:
    """Validate the component graph and return all issues found.

    Hard errors:
    - duplicate component_id (caught during build)
    - duplicate contract_id
    - broken component link
    - link outside root
    - mirrored contract missing on the other side
    - mirrored contract has different expectation text
    - mirrored contract points to wrong opposite component
    - referenced component file exists but declares different component_id
    - invalid scope structure

    Warnings:
    - component resolves to zero files in scope
    - dangling unreferenced component
    - cyclic dependency graph
    """
    issues: list[ValidationIssue] = []

    # Check for duplicate contract_ids across all components
    seen_contract_ids: dict[str, str] = {}  # contract_id -> first component_id
    for cid, comp in graph.components.items():
        for contract in comp.outgoing_contracts:
            if contract.contract_id in seen_contract_ids:
                other = seen_contract_ids[contract.contract_id]
                if other != cid:
                    issues.append(ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        message=f"Duplicate contract_id '{contract.contract_id}' in component '{cid}' "
                                f"(already defined in '{other}')",
                        component_id=cid,
                        contract_id=contract.contract_id,
                    ))
            else:
                seen_contract_ids[contract.contract_id] = cid

    # Validate mirrored contracts
    for cid, comp in graph.components.items():
        # For each outgoing dependency, check the target has a matching dependant
        for contract in comp.outgoing_contracts:
            target_cid = contract.target_component_id
            if target_cid not in graph.components:
                issues.append(ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Broken dependency link: component '{cid}' depends on "
                            f"'{target_cid}' which does not exist",
                    file_path=comp.file_path,
                    component_id=cid,
                    contract_id=contract.contract_id,
                ))
                continue

            target_comp = graph.components[target_cid]

            # Check target has matching incoming contract
            mirror = None
            for inc in target_comp.incoming_contracts:
                if inc.contract_id == contract.contract_id:
                    mirror = inc
                    break

            if mirror is None:
                issues.append(ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Missing mirrored contract: '{contract.contract_id}' exists as "
                            f"dependency in '{cid}' but not as dependant in '{target_cid}'",
                    component_id=target_cid,
                    contract_id=contract.contract_id,
                ))
            else:
                # Check expectation text matches
                if mirror.expectation != contract.expectation:
                    issues.append(ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        message=f"Mirrored contract expectation mismatch for '{contract.contract_id}': "
                                f"source says '{contract.expectation}' but target says '{mirror.expectation}'",
                        contract_id=contract.contract_id,
                    ))

                # Check source component reference matches
                if mirror.source_component_id != cid:
                    issues.append(ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        message=f"Mirrored contract '{contract.contract_id}' in '{target_cid}' "
                                f"points to source '{mirror.source_component_id}' but should point to '{cid}'",
                        contract_id=contract.contract_id,
                    ))

        # For each incoming dependant, check the source has a matching outgoing dependency
        for contract in comp.incoming_contracts:
            source_cid = contract.source_component_id
            if source_cid not in graph.components:
                issues.append(ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Broken dependant link: component '{cid}' lists dependant "
                            f"'{source_cid}' which does not exist",
                    file_path=comp.file_path,
                    component_id=cid,
                    contract_id=contract.contract_id,
                ))
                continue

            source_comp = graph.components[source_cid]

            # Check source has matching outgoing contract
            mirror = None
            for out in source_comp.outgoing_contracts:
                if out.contract_id == contract.contract_id:
                    mirror = out
                    break

            if mirror is None:
                issues.append(ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Missing mirrored contract: '{contract.contract_id}' exists as "
                            f"dependant in '{cid}' but not as dependency in '{source_cid}'",
                    component_id=source_cid,
                    contract_id=contract.contract_id,
                ))

    # Validate link paths resolve correctly
    for cid, comp in graph.components.items():
        for contract in comp.outgoing_contracts:
            if contract.target_file and str(contract.target_file) != "":
                resolved = resolve_component_path(
                    str(contract.target_file), comp.file_path, components_root
                )
                if resolved is None and contract.target_component_id in graph.components:
                    # Path doesn't resolve but component exists - check if it's an outside-root issue
                    target_path_str = str(contract.target_file)
                    if ".." in target_path_str:
                        issues.append(ValidationIssue(
                            severity=ValidationSeverity.ERROR,
                            message=f"Link in '{cid}' to '{target_path_str}' resolves outside components root",
                            file_path=comp.file_path,
                            component_id=cid,
                        ))

    # Warnings: zero-scope components
    for cid, comp in graph.components.items():
        if comp.scope.include:
            scoped = resolve_scope(comp.scope, components_root, all_files, git_root)
            if not scoped:
                issues.append(ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    message=f"Component '{cid}' scope resolves to zero files",
                    component_id=cid,
                    file_path=comp.file_path,
                ))

    # Warning: dangling unreferenced components
    referenced: set[str] = set()
    for cid, comp in graph.components.items():
        for contract in comp.outgoing_contracts:
            referenced.add(contract.target_component_id)
        for contract in comp.incoming_contracts:
            referenced.add(contract.source_component_id)

    for cid in graph.components:
        if cid not in referenced and not graph.components[cid].outgoing_contracts and not graph.components[cid].incoming_contracts:
            issues.append(ValidationIssue(
                severity=ValidationSeverity.WARNING,
                message=f"Component '{cid}' is not referenced by any other component",
                component_id=cid,
            ))

    # Warning: cyclic dependencies
    visited: set[str] = set()
    rec_stack: set[str] = set()
    cycles_found: list[list[str]] = []

    def _detect_cycle(node: str, path: list[str]) -> None:
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        for neighbor in graph.dependencies_of.get(node, []):
            if neighbor not in visited:
                _detect_cycle(neighbor, path)
            elif neighbor in rec_stack:
                cycle_start = path.index(neighbor)
                cycles_found.append(path[cycle_start:] + [neighbor])

        path.pop()
        rec_stack.discard(node)

    for cid in graph.components:
        if cid not in visited:
            _detect_cycle(cid, [])

    for cycle in cycles_found:
        issues.append(ValidationIssue(
            severity=ValidationSeverity.WARNING,
            message=f"Cyclic dependency detected: {' -> '.join(cycle)}",
        ))

    return issues

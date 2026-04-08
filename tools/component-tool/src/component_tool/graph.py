"""Graph builder - constructs the ComponentGraph from parsed component files."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pathspec

from .models import Component, ComponentGraph, DependencyContract, ScopeSpec
from .parser import parse_component_file
from .scanner import resolve_component_path, scan_component_files


def _list_tracked_files(git_root: Path) -> list[str]:
    """List all tracked files in the git repo."""
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=str(git_root),
            capture_output=True,
            text=True,
            check=True,
        )
        return [line for line in result.stdout.strip().split("\n") if line]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


def _list_all_non_ignored_files(root: Path, git_root: Path | None) -> list[str]:
    """List all non-ignored files under root, relative to root."""
    if git_root:
        tracked = _list_tracked_files(git_root)
        # Also get untracked but not ignored
        try:
            result = subprocess.run(
                ["git", "ls-files", "--others", "--exclude-standard"],
                cwd=str(git_root),
                capture_output=True,
                text=True,
                check=True,
            )
            untracked = [line for line in result.stdout.strip().split("\n") if line]
        except (subprocess.CalledProcessError, FileNotFoundError):
            untracked = []

        all_files = tracked + untracked
        # Convert to paths relative to root
        root_resolved = root.resolve()
        git_root_resolved = git_root.resolve()
        result_paths = []
        for f in all_files:
            abs_path = git_root_resolved / f
            try:
                rel = abs_path.relative_to(root_resolved)
                result_paths.append(str(rel))
            except ValueError:
                continue
        return sorted(set(result_paths))
    else:
        # No git, just walk
        result_paths = []
        for path in sorted(root.rglob("*")):
            if path.is_file():
                result_paths.append(str(path.relative_to(root)))
        return result_paths


def resolve_scope(
    scope: ScopeSpec,
    components_root: Path,
    all_files: list[str] | None = None,
    git_root: Path | None = None,
) -> list[str]:
    """Resolve scope patterns to a list of files relative to components_root."""
    if all_files is None:
        all_files = _list_all_non_ignored_files(components_root, git_root)

    if not scope.include:
        return []

    include_spec = pathspec.PathSpec.from_lines("gitignore", scope.include)
    matched = set(include_spec.match_files(all_files))

    if scope.exclude:
        exclude_spec = pathspec.PathSpec.from_lines("gitignore", scope.exclude)
        excluded = set(exclude_spec.match_files(all_files))
        matched -= excluded

    return sorted(matched)


def build_graph(
    components_root: Path,
    git_root: Path | None = None,
) -> ComponentGraph:
    """Build the full component graph from .component.md files under the root."""
    component_files = scan_component_files(components_root, git_root)
    all_files = _list_all_non_ignored_files(components_root, git_root)

    graph = ComponentGraph()

    # First pass: parse all component files
    parsed: dict[str, tuple] = {}  # component_id -> (frontmatter, description, file_path)
    file_to_id: dict[Path, str] = {}

    for file_path in component_files:
        try:
            frontmatter, description = parse_component_file(file_path)
        except (ValueError, KeyError):
            # Skip files without valid YAML frontmatter (e.g. legacy .component.md files)
            continue
        cid = frontmatter.component_id
        parsed[cid] = (frontmatter, description, file_path)
        file_to_id[file_path] = cid

    # Second pass: build components and contracts
    for cid, (fm, desc, fpath) in parsed.items():
        component = Component(
            component_id=cid,
            title=fm.title,
            file_path=fpath,
            description_markdown=desc,
            scope=fm.scope,
        )

        # Resolve scope
        scoped_files = resolve_scope(fm.scope, components_root, all_files, git_root)
        for sf in scoped_files:
            if sf not in graph.file_to_components:
                graph.file_to_components[sf] = []
            graph.file_to_components[sf].append(cid)

        # Process outgoing dependencies
        for dep in fm.dependencies:
            target_path = None
            if dep.target_path:
                target_path = resolve_component_path(dep.target_path, fpath, components_root)

            contract = DependencyContract(
                contract_id=dep.contract_id,
                source_component_id=cid,
                target_component_id=dep.target_component_id or "",
                expectation=dep.expectation,
                source_file=fpath,
                target_file=target_path or Path(dep.target_path or ""),
            )
            component.outgoing_contracts.append(contract)
            graph.contracts[dep.contract_id] = contract

            # Build dependency index
            if cid not in graph.dependencies_of:
                graph.dependencies_of[cid] = []
            if dep.target_component_id:
                graph.dependencies_of[cid].append(dep.target_component_id)

        # Process incoming dependants
        for dep in fm.dependants:
            source_path = None
            if dep.source_path:
                source_path = resolve_component_path(dep.source_path, fpath, components_root)

            contract = DependencyContract(
                contract_id=dep.contract_id,
                source_component_id=dep.source_component_id or "",
                target_component_id=cid,
                expectation=dep.expectation,
                source_file=source_path or Path(dep.source_path or ""),
                target_file=fpath,
            )
            component.incoming_contracts.append(contract)
            # Don't overwrite if already set from the source side
            if dep.contract_id not in graph.contracts:
                graph.contracts[dep.contract_id] = contract

            # Build dependant index
            if cid not in graph.dependants_of:
                graph.dependants_of[cid] = []
            if dep.source_component_id:
                graph.dependants_of[cid].append(dep.source_component_id)

        graph.components[cid] = component

    return graph

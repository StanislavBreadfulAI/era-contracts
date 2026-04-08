"""Editor - creates and updates .component.md files."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from .models import ComponentFrontmatter, DependencyEntry, ScopeSpec
from .parser import parse_component_file, render_component_file


def generate_contract_id() -> str:
    """Generate a unique contract_id."""
    return f"dep.{uuid.uuid4().hex[:12]}"


def create_component_file(
    file_path: Path,
    component_id: str,
    title: str,
    scope_include: list[str] | None = None,
    scope_exclude: list[str] | None = None,
    description: str = "",
    force: bool = False,
) -> Path:
    """Create a new .component.md file.

    Raises FileExistsError if file already exists and force is False.
    """
    if file_path.exists() and not force:
        raise FileExistsError(f"File already exists: {file_path}. Use --force to overwrite.")

    fm = ComponentFrontmatter(
        schema_version=1,
        component_id=component_id,
        title=title,
        scope=ScopeSpec(
            include=scope_include or [],
            exclude=scope_exclude or [],
        ),
    )

    content = render_component_file(fm, description or "TODO: Describe this component.")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    return file_path


def add_dependency(
    source_file: Path,
    target_file: Path,
    expectation: str,
    contract_id: str | None = None,
    components_root: Path | None = None,
) -> str:
    """Add a dependency contract between two component files.

    Updates both files: adds outgoing dep to source, incoming dep to target.
    Returns the contract_id used.
    """
    if contract_id is None:
        contract_id = generate_contract_id()

    # Parse both files
    source_fm, source_desc = parse_component_file(source_file)
    target_fm, target_desc = parse_component_file(target_file)

    # Check for duplicate contract_id
    for dep in source_fm.dependencies:
        if dep.contract_id == contract_id:
            raise ValueError(f"Contract '{contract_id}' already exists in {source_file}")
    for dep in target_fm.dependants:
        if dep.contract_id == contract_id:
            raise ValueError(f"Contract '{contract_id}' already exists in {target_file}")

    # Compute relative paths
    source_to_target = os.path.relpath(target_file, source_file.parent)
    target_to_source = os.path.relpath(source_file, target_file.parent)

    # Add outgoing dependency to source
    source_fm.dependencies.append(DependencyEntry(
        contract_id=contract_id,
        target_component_id=target_fm.component_id,
        target_path=source_to_target,
        expectation=expectation,
    ))

    # Add incoming dependant to target
    target_fm.dependants.append(DependencyEntry(
        contract_id=contract_id,
        source_component_id=source_fm.component_id,
        source_path=target_to_source,
        expectation=expectation,
    ))

    # Write both files
    source_content = render_component_file(source_fm, source_desc)
    target_content = render_component_file(target_fm, target_desc)

    source_file.write_text(source_content, encoding="utf-8")
    target_file.write_text(target_content, encoding="utf-8")

    return contract_id

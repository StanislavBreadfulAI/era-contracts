"""Parser for .component.md files with YAML frontmatter."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from .models import ComponentFrontmatter, DependencyEntry, ScopeSpec

yaml = YAML()
yaml.preserve_quotes = True

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
DESCRIPTION_RE = re.compile(
    r"## Description\s*\n(.*?)(?=\n## |\Z)", re.DOTALL
)

GENERATED_START = "<!-- component-tool:generated:start -->"
GENERATED_END = "<!-- component-tool:generated:end -->"


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Parse YAML frontmatter from a .component.md file.

    Returns (frontmatter_dict, body_after_frontmatter).
    """
    match = FRONTMATTER_RE.match(content)
    if not match:
        raise ValueError("No YAML frontmatter found in component file")

    yaml_text = match.group(1)
    body = content[match.end():]

    from io import StringIO
    data = yaml.load(StringIO(yaml_text))
    if data is None:
        data = {}

    return dict(data), body


def parse_component_file(file_path: Path) -> tuple[ComponentFrontmatter, str]:
    """Parse a .component.md file into structured data and description.

    Returns (frontmatter, description_markdown).
    """
    content = file_path.read_text(encoding="utf-8")
    data, body = parse_frontmatter(content)

    # Parse scope
    scope_data = data.get("scope", {})
    scope = ScopeSpec(
        include=scope_data.get("include", []) if scope_data else [],
        exclude=scope_data.get("exclude", []) if scope_data else [],
    )

    # Parse dependencies
    deps = []
    for dep in data.get("dependencies", []) or []:
        deps.append(DependencyEntry(
            contract_id=dep["contract_id"],
            target_component_id=dep.get("target_component_id"),
            target_path=dep.get("target_path"),
            expectation=dep["expectation"],
        ))

    # Parse dependants
    dependants = []
    for dep in data.get("dependants", []) or []:
        dependants.append(DependencyEntry(
            contract_id=dep["contract_id"],
            source_component_id=dep.get("source_component_id"),
            source_path=dep.get("source_path"),
            expectation=dep["expectation"],
        ))

    frontmatter = ComponentFrontmatter(
        schema_version=data.get("schema_version", 1),
        component_id=data["component_id"],
        title=data.get("title", ""),
        scope=scope,
        dependencies=deps,
        dependants=dependants,
    )

    # Extract description from body
    desc_match = DESCRIPTION_RE.search(body)
    description = ""
    if desc_match:
        raw_desc = desc_match.group(1).strip()
        # Remove generated markers if present
        if GENERATED_START in raw_desc:
            description = raw_desc
        else:
            description = raw_desc

    return frontmatter, description


def frontmatter_to_yaml(fm: ComponentFrontmatter) -> str:
    """Serialize ComponentFrontmatter to a YAML string (without --- delimiters)."""
    from io import StringIO

    data: dict[str, Any] = {
        "schema_version": fm.schema_version,
        "component_id": fm.component_id,
        "title": fm.title,
    }

    if fm.scope.include or fm.scope.exclude:
        scope_dict: dict[str, list[str]] = {}
        if fm.scope.include:
            scope_dict["include"] = fm.scope.include
        if fm.scope.exclude:
            scope_dict["exclude"] = fm.scope.exclude
        data["scope"] = scope_dict

    if fm.dependencies:
        data["dependencies"] = []
        for dep in fm.dependencies:
            d: dict[str, str] = {"contract_id": dep.contract_id}
            if dep.target_component_id:
                d["target_component_id"] = dep.target_component_id
            if dep.target_path:
                d["target_path"] = dep.target_path
            d["expectation"] = dep.expectation
            data["dependencies"].append(d)

    if fm.dependants:
        data["dependants"] = []
        for dep in fm.dependants:
            d = {"contract_id": dep.contract_id}
            if dep.source_component_id:
                d["source_component_id"] = dep.source_component_id
            if dep.source_path:
                d["source_path"] = dep.source_path
            d["expectation"] = dep.expectation
            data["dependants"].append(d)

    stream = StringIO()
    yaml.dump(data, stream)
    return stream.getvalue()


def generate_scope_section(scope: ScopeSpec) -> str:
    """Generate the Scope section body from structured data."""
    lines = []
    for pattern in scope.include:
        lines.append(f"- include: `{pattern}`")
    for pattern in scope.exclude:
        lines.append(f"- exclude: `{pattern}`")
    return "\n".join(lines) if lines else "- (no scope defined)"


def generate_dependencies_section(
    deps: list[DependencyEntry],
) -> str:
    """Generate the Dependencies section body from structured data."""
    if not deps:
        return "- (none)"
    lines = []
    for dep in deps:
        target_id = dep.target_component_id or "unknown"
        target_path = dep.target_path or ""
        if target_path:
            lines.append(
                f"- `{dep.contract_id}` [{target_id}]({target_path}) \u2014 {dep.expectation}"
            )
        else:
            lines.append(
                f"- `{dep.contract_id}` {target_id} \u2014 {dep.expectation}"
            )
    return "\n".join(lines)


def generate_dependants_section(
    deps: list[DependencyEntry],
) -> str:
    """Generate the Dependants section body from structured data."""
    if not deps:
        return "- (none)"
    lines = []
    for dep in deps:
        source_id = dep.source_component_id or "unknown"
        source_path = dep.source_path or ""
        if source_path:
            lines.append(
                f"- `{dep.contract_id}` [{source_id}]({source_path}) \u2014 {dep.expectation}"
            )
        else:
            lines.append(
                f"- `{dep.contract_id}` {source_id} \u2014 {dep.expectation}"
            )
    return "\n".join(lines)


def render_component_file(
    fm: ComponentFrontmatter,
    description: str,
) -> str:
    """Render a complete .component.md file from structured data and description."""
    yaml_str = frontmatter_to_yaml(fm)
    scope_body = generate_scope_section(fm.scope)
    deps_body = generate_dependencies_section(fm.dependencies)
    dependants_body = generate_dependants_section(fm.dependants)

    return f"""---
{yaml_str.rstrip()}
---

# {fm.title}

## Description
{description}

## Scope
{GENERATED_START}
{scope_body}
{GENERATED_END}

## Dependencies
{GENERATED_START}
{deps_body}
{GENERATED_END}

## Dependants
{GENERATED_START}
{dependants_body}
{GENERATED_END}
"""

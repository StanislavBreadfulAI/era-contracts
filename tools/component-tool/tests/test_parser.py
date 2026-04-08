"""Tests for the component file parser."""

from __future__ import annotations

from pathlib import Path

import pytest

from component_tool.models import ComponentFrontmatter, DependencyEntry, ScopeSpec
from component_tool.parser import (
    frontmatter_to_yaml,
    generate_dependencies_section,
    generate_dependants_section,
    generate_scope_section,
    parse_component_file,
    parse_frontmatter,
    render_component_file,
)


class TestParseFrontmatter:
    def test_basic_frontmatter(self):
        content = """---
schema_version: 1
component_id: test.comp
title: Test Component
---

# Test Component
"""
        data, body = parse_frontmatter(content)
        assert data["component_id"] == "test.comp"
        assert data["title"] == "Test Component"
        assert "# Test Component" in body

    def test_missing_frontmatter(self):
        with pytest.raises(ValueError, match="No YAML frontmatter"):
            parse_frontmatter("# Just a heading\nNo frontmatter here.")

    def test_frontmatter_with_scope(self):
        content = """---
schema_version: 1
component_id: my.comp
title: My Component
scope:
  include:
    - "src/**"
  exclude:
    - "**/*_test.py"
---

body
"""
        data, _ = parse_frontmatter(content)
        assert data["scope"]["include"] == ["src/**"]
        assert data["scope"]["exclude"] == ["**/*_test.py"]

    def test_frontmatter_with_dependencies(self):
        content = """---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: b
    target_path: ./b.component.md
    expectation: B does something.
---

body
"""
        data, _ = parse_frontmatter(content)
        assert len(data["dependencies"]) == 1
        assert data["dependencies"][0]["contract_id"] == "dep.x"


class TestParseComponentFile:
    def test_parse_full_file(self, tmp_path: Path):
        content = """---
schema_version: 1
component_id: test.full
title: Full Test
scope:
  include:
    - "src/**"
dependencies:
  - contract_id: dep.abc
    target_component_id: other
    target_path: ./other.component.md
    expectation: Other provides X.
dependants:
  - contract_id: dep.def
    source_component_id: caller
    source_path: ./caller.component.md
    expectation: This provides Y.
---

# Full Test

## Description
This is a description.

## Scope
<!-- component-tool:generated:start -->
- include: `src/**`
<!-- component-tool:generated:end -->
"""
        f = tmp_path / "test.component.md"
        f.write_text(content)

        fm, desc = parse_component_file(f)
        assert fm.component_id == "test.full"
        assert fm.title == "Full Test"
        assert fm.scope.include == ["src/**"]
        assert len(fm.dependencies) == 1
        assert fm.dependencies[0].contract_id == "dep.abc"
        assert len(fm.dependants) == 1
        assert fm.dependants[0].contract_id == "dep.def"
        assert "This is a description" in desc


class TestRenderComponentFile:
    def test_round_trip(self, tmp_path: Path):
        fm = ComponentFrontmatter(
            schema_version=1,
            component_id="round.trip",
            title="Round Trip",
            scope=ScopeSpec(include=["src/**"], exclude=["**/*_test.py"]),
            dependencies=[
                DependencyEntry(
                    contract_id="dep.rt1",
                    target_component_id="target",
                    target_path="./target.component.md",
                    expectation="Target does things.",
                )
            ],
            dependants=[
                DependencyEntry(
                    contract_id="dep.rt2",
                    source_component_id="caller",
                    source_path="./caller.component.md",
                    expectation="We provide things.",
                )
            ],
        )
        desc = "A round-trip test component."
        content = render_component_file(fm, desc)

        # Write and re-parse
        f = tmp_path / "round.trip.component.md"
        f.write_text(content)
        fm2, desc2 = parse_component_file(f)

        assert fm2.component_id == fm.component_id
        assert fm2.title == fm.title
        assert fm2.scope.include == fm.scope.include
        assert fm2.scope.exclude == fm.scope.exclude
        assert len(fm2.dependencies) == 1
        assert fm2.dependencies[0].contract_id == "dep.rt1"
        assert len(fm2.dependants) == 1
        assert fm2.dependants[0].contract_id == "dep.rt2"
        assert "round-trip test" in desc2


class TestGenerateSections:
    def test_scope_section(self):
        scope = ScopeSpec(include=["src/**", "lib/**"], exclude=["**/*.pyc"])
        result = generate_scope_section(scope)
        assert "- include: `src/**`" in result
        assert "- include: `lib/**`" in result
        assert "- exclude: `**/*.pyc`" in result

    def test_empty_scope(self):
        result = generate_scope_section(ScopeSpec())
        assert "(no scope defined)" in result

    def test_dependencies_section(self):
        deps = [
            DependencyEntry(
                contract_id="dep.x",
                target_component_id="target",
                target_path="./target.component.md",
                expectation="Does X.",
            )
        ]
        result = generate_dependencies_section(deps)
        assert "`dep.x`" in result
        assert "[target]" in result
        assert "Does X." in result

    def test_empty_dependencies(self):
        result = generate_dependencies_section([])
        assert "(none)" in result

    def test_dependants_section(self):
        deps = [
            DependencyEntry(
                contract_id="dep.y",
                source_component_id="caller",
                source_path="./caller.component.md",
                expectation="Provides Y.",
            )
        ]
        result = generate_dependants_section(deps)
        assert "`dep.y`" in result
        assert "[caller]" in result

"""Tests for the editor module."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from component_tool.editor import add_dependency, create_component_file
from component_tool.parser import parse_component_file


class TestCreateComponentFile:
    def test_creates_file(self, tmp_path: Path):
        f = tmp_path / "test.component.md"
        create_component_file(
            file_path=f,
            component_id="test.comp",
            title="Test Component",
            scope_include=["src/**"],
            scope_exclude=["**/*_test.py"],
            description="A test component.",
        )
        assert f.exists()
        fm, desc = parse_component_file(f)
        assert fm.component_id == "test.comp"
        assert fm.title == "Test Component"
        assert fm.scope.include == ["src/**"]
        assert fm.scope.exclude == ["**/*_test.py"]
        assert "test component" in desc.lower()

    def test_refuses_overwrite(self, tmp_path: Path):
        f = tmp_path / "test.component.md"
        f.write_text("existing")
        with pytest.raises(FileExistsError):
            create_component_file(
                file_path=f,
                component_id="test.comp",
                title="Test",
            )

    def test_force_overwrite(self, tmp_path: Path):
        f = tmp_path / "test.component.md"
        f.write_text("existing")
        create_component_file(
            file_path=f,
            component_id="test.comp",
            title="Test",
            force=True,
        )
        fm, _ = parse_component_file(f)
        assert fm.component_id == "test.comp"

    def test_creates_parent_dirs(self, tmp_path: Path):
        f = tmp_path / "deep" / "nested" / "dir" / "test.component.md"
        create_component_file(
            file_path=f,
            component_id="deep.test",
            title="Deep Test",
        )
        assert f.exists()


class TestAddDependency:
    def test_adds_mirrored_dependency(self, tmp_path: Path):
        source = tmp_path / "source.component.md"
        target = tmp_path / "target.component.md"

        create_component_file(source, "source", "Source")
        create_component_file(target, "target", "Target")

        contract_id = add_dependency(
            source_file=source,
            target_file=target,
            expectation="Target provides X.",
        )

        # Check source has outgoing dep
        source_fm, _ = parse_component_file(source)
        assert len(source_fm.dependencies) == 1
        dep = source_fm.dependencies[0]
        assert dep.contract_id == contract_id
        assert dep.target_component_id == "target"
        assert dep.expectation == "Target provides X."

        # Check target has incoming dep
        target_fm, _ = parse_component_file(target)
        assert len(target_fm.dependants) == 1
        dep = target_fm.dependants[0]
        assert dep.contract_id == contract_id
        assert dep.source_component_id == "source"
        assert dep.expectation == "Target provides X."

    def test_explicit_contract_id(self, tmp_path: Path):
        source = tmp_path / "source.component.md"
        target = tmp_path / "target.component.md"

        create_component_file(source, "source", "Source")
        create_component_file(target, "target", "Target")

        contract_id = add_dependency(
            source_file=source,
            target_file=target,
            expectation="Target provides X.",
            contract_id="dep.my_custom_id",
        )
        assert contract_id == "dep.my_custom_id"

    def test_rejects_duplicate_contract_id(self, tmp_path: Path):
        source = tmp_path / "source.component.md"
        target = tmp_path / "target.component.md"

        create_component_file(source, "source", "Source")
        create_component_file(target, "target", "Target")

        add_dependency(
            source_file=source,
            target_file=target,
            expectation="First dep.",
            contract_id="dep.dup",
        )

        with pytest.raises(ValueError, match="already exists"):
            add_dependency(
                source_file=source,
                target_file=target,
                expectation="Second dep.",
                contract_id="dep.dup",
            )

    def test_multiple_dependencies(self, tmp_path: Path):
        source = tmp_path / "source.component.md"
        target = tmp_path / "target.component.md"

        create_component_file(source, "source", "Source")
        create_component_file(target, "target", "Target")

        add_dependency(source, target, "First expectation.")
        add_dependency(source, target, "Second expectation.")

        source_fm, _ = parse_component_file(source)
        assert len(source_fm.dependencies) == 2

        target_fm, _ = parse_component_file(target)
        assert len(target_fm.dependants) == 2

    def test_preserves_description(self, tmp_path: Path):
        source = tmp_path / "source.component.md"
        target = tmp_path / "target.component.md"

        create_component_file(source, "source", "Source", description="My custom description.")
        create_component_file(target, "target", "Target", description="Target description.")

        add_dependency(source, target, "Some expectation.")

        _, source_desc = parse_component_file(source)
        assert "My custom description" in source_desc

        _, target_desc = parse_component_file(target)
        assert "Target description" in target_desc

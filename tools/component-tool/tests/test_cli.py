"""Integration tests for the CLI."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from component_tool.cli import app

runner = CliRunner()


class TestListAll:
    def test_empty_repo(self, tmp_git_repo: Path):
        result = runner.invoke(app, ["list-all", "-w", str(tmp_git_repo)])
        assert result.exit_code == 0

    def test_with_components(self, two_component_repo: Path):
        result = runner.invoke(app, ["list-all", "-w", str(two_component_repo)])
        assert result.exit_code == 0
        assert "app.main" in result.stdout
        assert "lib.shared" in result.stdout

    def test_json_output(self, two_component_repo: Path):
        result = runner.invoke(app, ["list-all", "-w", str(two_component_repo), "--json"])
        assert result.exit_code == 0
        data = json.loads(result.stdout)
        assert len(data) == 2
        ids = [c["component_id"] for c in data]
        assert "app.main" in ids
        assert "lib.shared" in ids


class TestListDeps:
    def test_list_deps_for_component(self, two_component_repo: Path):
        result = runner.invoke(app, ["list-deps", "app.main", "-w", str(two_component_repo)])
        assert result.exit_code == 0
        assert "dep.uses_shared" in result.stdout

    def test_list_deps_filtered(self, two_component_repo: Path):
        result = runner.invoke(
            app, ["list-deps", "app.main", "lib.shared", "-w", str(two_component_repo)]
        )
        assert result.exit_code == 0
        assert "dep.uses_shared" in result.stdout

    def test_list_deps_no_match(self, two_component_repo: Path):
        result = runner.invoke(
            app, ["list-deps", "lib.shared", "-w", str(two_component_repo)]
        )
        assert result.exit_code == 1

    def test_list_deps_nonexistent(self, two_component_repo: Path):
        result = runner.invoke(
            app, ["list-deps", "nonexistent", "-w", str(two_component_repo)]
        )
        assert result.exit_code == 1

    def test_json_output(self, two_component_repo: Path):
        result = runner.invoke(
            app, ["list-deps", "app.main", "-w", str(two_component_repo), "--json"]
        )
        assert result.exit_code == 0
        data = json.loads(result.stdout)
        assert len(data) == 1
        assert data[0]["contract_id"] == "dep.uses_shared"


class TestAddComp:
    def test_creates_component(self, tmp_git_repo: Path):
        result = runner.invoke(app, [
            "add-comp", "new.component.md",
            "--id", "new.comp",
            "--title", "New Component",
            "--scope", "src/**",
            "-w", str(tmp_git_repo),
        ])
        assert result.exit_code == 0
        assert (tmp_git_repo / "new.component.md").exists()

    def test_refuses_overwrite(self, two_component_repo: Path):
        result = runner.invoke(app, [
            "add-comp", "app.main.component.md",
            "--id", "app.main",
            "-w", str(two_component_repo),
        ])
        assert result.exit_code == 1


class TestAddDep:
    def test_adds_dependency(self, two_component_repo: Path):
        result = runner.invoke(app, [
            "add-dep", "lib.shared", "app.main",
            "Main app provides the entry point.",
            "-w", str(two_component_repo),
        ])
        assert result.exit_code == 0

        # Verify both files were updated
        from component_tool.parser import parse_component_file
        shared_fm, _ = parse_component_file(two_component_repo / "lib.shared.component.md")
        assert len(shared_fm.dependencies) == 1

        main_fm, _ = parse_component_file(two_component_repo / "app.main.component.md")
        assert len(main_fm.dependants) == 1


class TestValidate:
    def test_valid_repo(self, two_component_repo: Path):
        result = runner.invoke(app, ["validate", "-w", str(two_component_repo)])
        # May have warnings but no errors
        assert result.exit_code == 0

    def test_json_output(self, two_component_repo: Path):
        result = runner.invoke(app, ["validate", "-w", str(two_component_repo), "--json"])
        assert result.exit_code == 0
        data = json.loads(result.stdout)
        assert isinstance(data, list)

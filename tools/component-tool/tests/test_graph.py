"""Tests for the graph builder and scope resolution."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from component_tool.graph import build_graph, resolve_scope
from component_tool.models import ScopeSpec


class TestResolveScope:
    def test_include_pattern(self, tmp_git_repo: Path):
        scope = ScopeSpec(include=["src/**"])
        files = resolve_scope(scope, tmp_git_repo, git_root=tmp_git_repo)
        assert "src/main.py" in files
        assert "src/utils.py" in files
        assert "src/main_test.py" in files

    def test_exclude_pattern(self, tmp_git_repo: Path):
        scope = ScopeSpec(include=["src/**"], exclude=["**/*_test.py"])
        files = resolve_scope(scope, tmp_git_repo, git_root=tmp_git_repo)
        assert "src/main.py" in files
        assert "src/utils.py" in files
        assert "src/main_test.py" not in files

    def test_empty_include(self, tmp_git_repo: Path):
        scope = ScopeSpec(include=[], exclude=[])
        files = resolve_scope(scope, tmp_git_repo, git_root=tmp_git_repo)
        assert files == []

    def test_no_match(self, tmp_git_repo: Path):
        scope = ScopeSpec(include=["nonexistent/**"])
        files = resolve_scope(scope, tmp_git_repo, git_root=tmp_git_repo)
        assert files == []

    def test_multiple_include_patterns(self, tmp_git_repo: Path):
        scope = ScopeSpec(include=["src/**", "lib/**"])
        files = resolve_scope(scope, tmp_git_repo, git_root=tmp_git_repo)
        assert "src/main.py" in files
        assert "lib/shared.py" in files


class TestBuildGraph:
    def test_builds_from_two_components(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        assert "app.main" in graph.components
        assert "lib.shared" in graph.components

    def test_contracts_populated(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        assert "dep.uses_shared" in graph.contracts

    def test_outgoing_contracts(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        main = graph.components["app.main"]
        assert len(main.outgoing_contracts) == 1
        assert main.outgoing_contracts[0].target_component_id == "lib.shared"

    def test_incoming_contracts(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        shared = graph.components["lib.shared"]
        assert len(shared.incoming_contracts) == 1
        assert shared.incoming_contracts[0].source_component_id == "app.main"

    def test_dependency_index(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        assert "lib.shared" in graph.dependencies_of.get("app.main", [])

    def test_dependant_index(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        assert "app.main" in graph.dependants_of.get("lib.shared", [])

    def test_file_to_components_index(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        # src/main.py should map to app.main
        assert "app.main" in graph.file_to_components.get("src/main.py", [])
        # lib/shared.py should map to lib.shared
        assert "lib.shared" in graph.file_to_components.get("lib/shared.py", [])

    def test_empty_repo(self, tmp_git_repo: Path):
        graph = build_graph(tmp_git_repo)
        assert len(graph.components) == 0

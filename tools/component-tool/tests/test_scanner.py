"""Tests for the component file scanner."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from component_tool.scanner import (
    find_git_root,
    is_gitignored,
    resolve_component_path,
    scan_component_files,
)


class TestFindGitRoot:
    def test_finds_root(self, tmp_git_repo: Path):
        root = find_git_root(tmp_git_repo)
        assert root is not None
        assert root == tmp_git_repo

    def test_finds_root_from_subdir(self, tmp_git_repo: Path):
        subdir = tmp_git_repo / "src"
        root = find_git_root(subdir)
        assert root == tmp_git_repo

    def test_returns_none_for_non_repo(self, tmp_path: Path):
        root = find_git_root(tmp_path)
        assert root is None


class TestIsGitignored:
    def test_tracked_file_not_ignored(self, tmp_git_repo: Path):
        assert not is_gitignored(tmp_git_repo / "src" / "main.py", tmp_git_repo)

    def test_gitignored_file(self, tmp_git_repo: Path):
        pyc_file = tmp_git_repo / "something.pyc"
        pyc_file.write_text("compiled")
        assert is_gitignored(pyc_file, tmp_git_repo)


class TestScanComponentFiles:
    def test_finds_component_files(self, two_component_repo: Path):
        files = scan_component_files(two_component_repo)
        names = [f.name for f in files]
        assert "app.main.component.md" in names
        assert "lib.shared.component.md" in names

    def test_excludes_gitignored(self, tmp_git_repo: Path):
        # Put a component file in a gitignored directory
        build_dir = tmp_git_repo / "build"
        build_dir.mkdir(exist_ok=True)
        (build_dir / "ignored.component.md").write_text("""---
schema_version: 1
component_id: ignored
title: Ignored
---
""")
        files = scan_component_files(tmp_git_repo)
        names = [f.name for f in files]
        assert "ignored.component.md" not in names

    def test_empty_repo(self, tmp_git_repo: Path):
        files = scan_component_files(tmp_git_repo)
        assert files == []


class TestResolveComponentPath:
    def test_resolves_sibling(self, two_component_repo: Path):
        from_file = two_component_repo / "app.main.component.md"
        result = resolve_component_path(
            "./lib.shared.component.md", from_file, two_component_repo
        )
        assert result is not None
        assert result.name == "lib.shared.component.md"

    def test_rejects_outside_root(self, two_component_repo: Path):
        from_file = two_component_repo / "app.main.component.md"
        result = resolve_component_path(
            "../../etc/passwd", from_file, two_component_repo
        )
        assert result is None

    def test_returns_none_for_missing(self, two_component_repo: Path):
        from_file = two_component_repo / "app.main.component.md"
        result = resolve_component_path(
            "./nonexistent.component.md", from_file, two_component_repo
        )
        assert result is None

"""Shared test fixtures."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def tmp_git_repo(tmp_path: Path) -> Path:
    """Create a temporary git repository with some files."""
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True, check=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=str(tmp_path), capture_output=True, check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=str(tmp_path), capture_output=True, check=True,
    )

    # Create some source files
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('hello')")
    (tmp_path / "src" / "utils.py").write_text("def helper(): pass")
    (tmp_path / "src" / "main_test.py").write_text("def test_main(): pass")
    (tmp_path / "lib").mkdir()
    (tmp_path / "lib" / "shared.py").write_text("SHARED = True")

    # Create a gitignored file
    (tmp_path / ".gitignore").write_text("*.pyc\n__pycache__/\nbuild/\n")
    (tmp_path / "build").mkdir()
    (tmp_path / "build" / "output.pyc").write_text("compiled")

    subprocess.run(["git", "add", "-A"], cwd=str(tmp_path), capture_output=True, check=True)
    subprocess.run(
        ["git", "commit", "-m", "init"],
        cwd=str(tmp_path), capture_output=True, check=True,
    )

    return tmp_path


SAMPLE_COMPONENT_A = """---
schema_version: 1
component_id: app.main
title: Main App
scope:
  include:
    - "src/**"
  exclude:
    - "**/*_test.py"
dependencies:
  - contract_id: dep.uses_shared
    target_component_id: lib.shared
    target_path: ./lib.shared.component.md
    expectation: Shared library provides the SHARED constant.
---

# Main App

## Description
The main application entry point.

## Scope
<!-- component-tool:generated:start -->
- include: `src/**`
- exclude: `**/*_test.py`
<!-- component-tool:generated:end -->

## Dependencies
<!-- component-tool:generated:start -->
- `dep.uses_shared` [lib.shared](./lib.shared.component.md) — Shared library provides the SHARED constant.
<!-- component-tool:generated:end -->

## Dependants
<!-- component-tool:generated:start -->
- (none)
<!-- component-tool:generated:end -->
"""

SAMPLE_COMPONENT_B = """---
schema_version: 1
component_id: lib.shared
title: Shared Library
scope:
  include:
    - "lib/**"
dependants:
  - contract_id: dep.uses_shared
    source_component_id: app.main
    source_path: ./app.main.component.md
    expectation: Shared library provides the SHARED constant.
---

# Shared Library

## Description
Provides shared utilities and constants.

## Scope
<!-- component-tool:generated:start -->
- include: `lib/**`
<!-- component-tool:generated:end -->

## Dependencies
<!-- component-tool:generated:start -->
- (none)
<!-- component-tool:generated:end -->

## Dependants
<!-- component-tool:generated:start -->
- `dep.uses_shared` [app.main](./app.main.component.md) — Shared library provides the SHARED constant.
<!-- component-tool:generated:end -->
"""


@pytest.fixture
def two_component_repo(tmp_git_repo: Path) -> Path:
    """A git repo with two properly mirrored components."""
    (tmp_git_repo / "app.main.component.md").write_text(SAMPLE_COMPONENT_A)
    (tmp_git_repo / "lib.shared.component.md").write_text(SAMPLE_COMPONENT_B)
    subprocess.run(
        ["git", "add", "-A"], cwd=str(tmp_git_repo), capture_output=True, check=True
    )
    subprocess.run(
        ["git", "commit", "-m", "add components"],
        cwd=str(tmp_git_repo), capture_output=True, check=True,
    )
    return tmp_git_repo

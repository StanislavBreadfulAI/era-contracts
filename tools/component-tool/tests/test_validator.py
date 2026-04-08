"""Tests for the graph validator."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from component_tool.graph import build_graph
from component_tool.models import ValidationSeverity
from component_tool.validator import validate_graph


class TestValidateGraph:
    def test_valid_mirrored_components(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        issues = validate_graph(graph, two_component_repo)
        errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
        assert len(errors) == 0

    def test_missing_mirror_on_target(self, tmp_git_repo: Path):
        """Source has dep but target doesn't list it as dependant."""
        (tmp_git_repo / "a.component.md").write_text("""---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: b
    target_path: ./b.component.md
    expectation: B does X.
---

# A

## Description
Component A.
""")
        (tmp_git_repo / "b.component.md").write_text("""---
schema_version: 1
component_id: b
title: B
---

# B

## Description
Component B.
""")
        subprocess.run(["git", "add", "-A"], cwd=str(tmp_git_repo), capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "add"], cwd=str(tmp_git_repo), capture_output=True, check=True)

        graph = build_graph(tmp_git_repo)
        issues = validate_graph(graph, tmp_git_repo)
        errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
        assert any("Missing mirrored contract" in e.message for e in errors)

    def test_expectation_mismatch(self, tmp_git_repo: Path):
        """Mirrored contracts have different expectation text."""
        (tmp_git_repo / "a.component.md").write_text("""---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: b
    target_path: ./b.component.md
    expectation: B does X.
---

# A

## Description
A.
""")
        (tmp_git_repo / "b.component.md").write_text("""---
schema_version: 1
component_id: b
title: B
dependants:
  - contract_id: dep.x
    source_component_id: a
    source_path: ./a.component.md
    expectation: B does Y.
---

# B

## Description
B.
""")
        subprocess.run(["git", "add", "-A"], cwd=str(tmp_git_repo), capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "add"], cwd=str(tmp_git_repo), capture_output=True, check=True)

        graph = build_graph(tmp_git_repo)
        issues = validate_graph(graph, tmp_git_repo)
        errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
        assert any("expectation mismatch" in e.message for e in errors)

    def test_broken_dependency_link(self, tmp_git_repo: Path):
        """Dependency references a non-existent component."""
        (tmp_git_repo / "a.component.md").write_text("""---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: nonexistent
    target_path: ./nonexistent.component.md
    expectation: Nonexistent does X.
---

# A

## Description
A.
""")
        subprocess.run(["git", "add", "-A"], cwd=str(tmp_git_repo), capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "add"], cwd=str(tmp_git_repo), capture_output=True, check=True)

        graph = build_graph(tmp_git_repo)
        issues = validate_graph(graph, tmp_git_repo)
        errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
        assert any("does not exist" in e.message for e in errors)

    def test_wrong_source_in_mirror(self, tmp_git_repo: Path):
        """Mirrored contract points to wrong source component."""
        (tmp_git_repo / "a.component.md").write_text("""---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: b
    target_path: ./b.component.md
    expectation: B does X.
---

# A

## Description
A.
""")
        (tmp_git_repo / "b.component.md").write_text("""---
schema_version: 1
component_id: b
title: B
dependants:
  - contract_id: dep.x
    source_component_id: wrong_source
    source_path: ./wrong.component.md
    expectation: B does X.
---

# B

## Description
B.
""")
        subprocess.run(["git", "add", "-A"], cwd=str(tmp_git_repo), capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "add"], cwd=str(tmp_git_repo), capture_output=True, check=True)

        graph = build_graph(tmp_git_repo)
        issues = validate_graph(graph, tmp_git_repo)
        errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
        assert any("points to source" in e.message for e in errors)

    def test_zero_scope_warning(self, tmp_git_repo: Path):
        """Component whose scope matches no files gets a warning."""
        (tmp_git_repo / "empty.component.md").write_text("""---
schema_version: 1
component_id: empty
title: Empty
scope:
  include:
    - "nonexistent_dir/**"
---

# Empty

## Description
No files.
""")
        subprocess.run(["git", "add", "-A"], cwd=str(tmp_git_repo), capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "add"], cwd=str(tmp_git_repo), capture_output=True, check=True)

        graph = build_graph(tmp_git_repo)
        issues = validate_graph(graph, tmp_git_repo)
        warnings = [i for i in issues if i.severity == ValidationSeverity.WARNING]
        assert any("zero files" in w.message for w in warnings)

    def test_unreferenced_component_warning(self, tmp_git_repo: Path):
        """Standalone component with no deps/dependants gets a warning."""
        (tmp_git_repo / "lonely.component.md").write_text("""---
schema_version: 1
component_id: lonely
title: Lonely
---

# Lonely

## Description
All alone.
""")
        subprocess.run(["git", "add", "-A"], cwd=str(tmp_git_repo), capture_output=True, check=True)
        subprocess.run(["git", "commit", "-m", "add"], cwd=str(tmp_git_repo), capture_output=True, check=True)

        graph = build_graph(tmp_git_repo)
        issues = validate_graph(graph, tmp_git_repo)
        warnings = [i for i in issues if i.severity == ValidationSeverity.WARNING]
        assert any("not referenced" in w.message for w in warnings)

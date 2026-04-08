"""Tests for the review engine with fake adapter."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from component_tool.agent_adapter import FakeAdapter
from component_tool.graph import build_graph
from component_tool.models import ReviewStatus
from component_tool.review_engine import (
    ReviewScheduler,
    ReviewTask,
    build_review_prompt,
    compute_component_fingerprint,
    get_changed_files,
    resolve_affected_components,
    run_single_review,
)


class TestBuildReviewPrompt:
    def test_contains_component_info(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        comp = graph.components["app.main"]
        prompt = build_review_prompt(comp, ["src/main.py"], two_component_repo)

        assert "app.main" in prompt
        assert "Main App" in prompt
        assert "dep.uses_shared" in prompt
        assert "lib.shared" in prompt

    def test_contains_file_contents(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        comp = graph.components["app.main"]
        prompt = build_review_prompt(comp, ["src/main.py"], two_component_repo)
        assert "print('hello')" in prompt

    def test_contains_json_schema(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        comp = graph.components["app.main"]
        prompt = build_review_prompt(comp, [], two_component_repo)
        assert '"status"' in prompt
        assert '"issues"' in prompt


class TestFakeAdapter:
    def test_returns_ok_by_default(self, two_component_repo: Path):
        adapter = FakeAdapter()
        graph = build_graph(two_component_repo)
        comp = graph.components["app.main"]
        result = run_single_review(comp, graph, two_component_repo, adapter)
        assert result.component_id == "app.main"

    def test_returns_custom_response(self, two_component_repo: Path):
        responses = {
            "app.main": {
                "component_id": "app.main",
                "status": "issues_found",
                "issues": [
                    {
                        "issue_id": 1,
                        "severity": "high",
                        "kind": "description_mismatch",
                        "title": "Test issue",
                        "details": "Something is wrong.",
                        "evidence": [{"path": "src/main.py", "lines": "1"}],
                        "suggested_action": "Fix it.",
                    }
                ],
                "proposed_invariants": [],
            }
        }
        adapter = FakeAdapter(responses=responses)
        graph = build_graph(two_component_repo)
        comp = graph.components["app.main"]
        result = run_single_review(comp, graph, two_component_repo, adapter)
        assert result.status == ReviewStatus.ISSUES_FOUND
        assert len(result.issues) == 1
        assert result.issues[0].title == "Test issue"


class TestReviewScheduler:
    def test_basic_queue(self):
        scheduler = ReviewScheduler()
        task = ReviewTask(component_id="a", reason="test", fingerprint="fp1")
        assert scheduler.enqueue(task)
        next_task = scheduler.next()
        assert next_task is not None
        assert next_task.component_id == "a"

    def test_deduplication_by_fingerprint(self):
        scheduler = ReviewScheduler()
        task1 = ReviewTask(component_id="a", reason="test", fingerprint="fp1")
        task2 = ReviewTask(component_id="a", reason="test2", fingerprint="fp1")
        assert scheduler.enqueue(task1)
        assert not scheduler.enqueue(task2)  # Same fingerprint, skipped

    def test_requeue_with_different_fingerprint(self):
        scheduler = ReviewScheduler()
        task1 = ReviewTask(component_id="a", reason="test", fingerprint="fp1")
        assert scheduler.enqueue(task1)
        assert scheduler.requeue("a", "changed", "fp2")  # Different fingerprint

    def test_empty_queue(self):
        scheduler = ReviewScheduler()
        assert scheduler.next() is None


class TestFingerprint:
    def test_same_state_same_fingerprint(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        comp = graph.components["app.main"]
        fp1 = compute_component_fingerprint(comp, two_component_repo)
        fp2 = compute_component_fingerprint(comp, two_component_repo)
        assert fp1 == fp2

    def test_different_after_file_change(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        comp = graph.components["app.main"]
        fp1 = compute_component_fingerprint(comp, two_component_repo)

        # Modify a scoped file
        (two_component_repo / "src" / "main.py").write_text("print('changed')")

        fp2 = compute_component_fingerprint(comp, two_component_repo)
        assert fp1 != fp2


class TestGetChangedFiles:
    def test_detects_unstaged_changes(self, two_component_repo: Path):
        (two_component_repo / "src" / "main.py").write_text("modified")
        changed = get_changed_files(two_component_repo)
        assert "src/main.py" in changed

    def test_detects_staged_changes(self, two_component_repo: Path):
        (two_component_repo / "src" / "main.py").write_text("modified")
        subprocess.run(
            ["git", "add", "src/main.py"],
            cwd=str(two_component_repo), capture_output=True, check=True,
        )
        changed = get_changed_files(two_component_repo)
        assert "src/main.py" in changed

    def test_detects_untracked_files(self, two_component_repo: Path):
        (two_component_repo / "new_file.py").write_text("new")
        changed = get_changed_files(two_component_repo)
        assert "new_file.py" in changed

    def test_no_changes(self, two_component_repo: Path):
        changed = get_changed_files(two_component_repo)
        assert changed == []


class TestResolveAffectedComponents:
    def test_scoped_file_change(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        affected = resolve_affected_components(
            ["src/main.py"], graph, two_component_repo, two_component_repo
        )
        assert "app.main" in affected

    def test_component_file_change(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        affected = resolve_affected_components(
            ["app.main.component.md"], graph, two_component_repo, two_component_repo
        )
        assert "app.main" in affected

    def test_unrelated_file(self, two_component_repo: Path):
        graph = build_graph(two_component_repo)
        affected = resolve_affected_components(
            ["unrelated.txt"], graph, two_component_repo, two_component_repo
        )
        assert len(affected) == 0

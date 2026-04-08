"""Tests for the report writer."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from component_tool.models import (
    Evidence,
    IssueKind,
    IssueSeverity,
    ProposedInvariant,
    ReviewIssue,
    ReviewResult,
    ReviewRun,
    ReviewStatus,
)
from component_tool.report_writer import write_reports


@pytest.fixture
def sample_run() -> ReviewRun:
    result = ReviewResult(
        component_id="test.comp",
        status=ReviewStatus.ISSUES_FOUND,
        issues=[
            ReviewIssue(
                issue_id=1,
                severity=IssueSeverity.HIGH,
                kind=IssueKind.DESCRIPTION_MISMATCH,
                title="Mismatch found",
                details="The description doesn't match the code.",
                evidence=[Evidence(path="src/main.py", lines="10-20")],
                suggested_action="Update the description.",
            )
        ],
        proposed_invariants=[
            ProposedInvariant(
                source_component_id="test.comp",
                target_component_id="other.comp",
                expectation="Other should provide Y.",
            )
        ],
        raw_agent_output="raw output here",
    )
    return ReviewRun(
        run_id="test-run-001",
        components_reviewed=["test.comp"],
        results={"test.comp": result},
    )


class TestWriteReports:
    def test_creates_run_directory(self, tmp_path: Path, sample_run: ReviewRun):
        run_dir = write_reports(sample_run, tmp_path)
        assert run_dir.exists()
        assert run_dir.name == "test-run-001"

    def test_writes_component_json(self, tmp_path: Path, sample_run: ReviewRun):
        run_dir = write_reports(sample_run, tmp_path)
        json_file = run_dir / "test.comp.json"
        assert json_file.exists()
        data = json.loads(json_file.read_text())
        assert data["component_id"] == "test.comp"
        assert data["status"] == "issues_found"
        assert len(data["issues"]) == 1

    def test_writes_component_md(self, tmp_path: Path, sample_run: ReviewRun):
        run_dir = write_reports(sample_run, tmp_path)
        md_file = run_dir / "test.comp.md"
        assert md_file.exists()
        content = md_file.read_text()
        assert "Mismatch found" in content
        assert "HIGH" in content

    def test_writes_raw_output(self, tmp_path: Path, sample_run: ReviewRun):
        run_dir = write_reports(sample_run, tmp_path)
        raw_file = run_dir / "test.comp.raw.txt"
        assert raw_file.exists()
        assert "raw output here" in raw_file.read_text()

    def test_writes_summary_json(self, tmp_path: Path, sample_run: ReviewRun):
        run_dir = write_reports(sample_run, tmp_path)
        summary = run_dir / "summary.json"
        assert summary.exists()
        data = json.loads(summary.read_text())
        assert data["run_id"] == "test-run-001"
        assert "test.comp" in data["results"]

    def test_writes_summary_md(self, tmp_path: Path, sample_run: ReviewRun):
        run_dir = write_reports(sample_run, tmp_path)
        summary = run_dir / "summary.md"
        assert summary.exists()
        content = summary.read_text()
        assert "test.comp" in content
        assert "issues_found" in content

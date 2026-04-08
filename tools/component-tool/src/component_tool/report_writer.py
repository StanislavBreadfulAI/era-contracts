"""Report writer - generates JSON and Markdown reports from review results."""

from __future__ import annotations

import json
from pathlib import Path

from .models import ReviewResult, ReviewRun


def write_reports(
    run: ReviewRun,
    output_dir: Path,
) -> Path:
    """Write all reports for a review run.

    Creates:
      <output_dir>/<run_id>/summary.json
      <output_dir>/<run_id>/summary.md
      <output_dir>/<run_id>/<component_id>.json
      <output_dir>/<run_id>/<component_id>.md
      <output_dir>/<run_id>/<component_id>.raw.txt

    Returns the run directory path.
    """
    run_dir = output_dir / run.run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Write per-component reports
    for cid, result in run.results.items():
        _write_component_json(result, run_dir)
        _write_component_md(result, run_dir)
        _write_component_raw(result, run_dir)

    # Write summary
    _write_summary_json(run, run_dir)
    _write_summary_md(run, run_dir)

    return run_dir


def _safe_filename(component_id: str) -> str:
    """Convert a component_id to a safe filename."""
    return component_id.replace("/", "_").replace("\\", "_")


def _write_component_json(result: ReviewResult, run_dir: Path) -> None:
    """Write per-component JSON report."""
    filename = _safe_filename(result.component_id)
    path = run_dir / f"{filename}.json"
    data = result.model_dump(mode="json", exclude={"raw_agent_output"})
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _write_component_md(result: ReviewResult, run_dir: Path) -> None:
    """Write per-component Markdown report."""
    filename = _safe_filename(result.component_id)
    path = run_dir / f"{filename}.md"

    lines = [
        f"# Review: {result.component_id}",
        "",
        f"**Status:** {result.status.value}",
        "",
    ]

    if result.issues:
        lines.append("## Issues")
        lines.append("")
        for issue in result.issues:
            lines.append(f"### {issue.issue_id}. [{issue.severity.value.upper()}] {issue.title}")
            lines.append("")
            lines.append(f"**Kind:** {issue.kind.value}")
            lines.append("")
            lines.append(issue.details)
            lines.append("")
            if issue.evidence:
                lines.append("**Evidence:**")
                for ev in issue.evidence:
                    loc = f"{ev.path}"
                    if ev.lines:
                        loc += f":{ev.lines}"
                    lines.append(f"- `{loc}`")
                lines.append("")
            if issue.suggested_action:
                lines.append(f"**Suggested action:** {issue.suggested_action}")
                lines.append("")
    else:
        lines.append("No issues found.")
        lines.append("")

    if result.proposed_invariants:
        lines.append("## Proposed Invariants")
        lines.append("")
        for inv in result.proposed_invariants:
            lines.append(
                f"- `{inv.source_component_id}` -> `{inv.target_component_id}`: "
                f"{inv.expectation}"
            )
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def _write_component_raw(result: ReviewResult, run_dir: Path) -> None:
    """Write raw agent output."""
    filename = _safe_filename(result.component_id)
    path = run_dir / f"{filename}.raw.txt"
    path.write_text(result.raw_agent_output or "(no raw output)", encoding="utf-8")


def _write_summary_json(run: ReviewRun, run_dir: Path) -> None:
    """Write summary JSON report."""
    path = run_dir / "summary.json"
    data = {
        "run_id": run.run_id,
        "components_reviewed": run.components_reviewed,
        "results": {},
    }
    for cid, result in run.results.items():
        data["results"][cid] = {
            "status": result.status.value,
            "issue_count": len(result.issues),
            "proposed_invariant_count": len(result.proposed_invariants),
        }
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _write_summary_md(run: ReviewRun, run_dir: Path) -> None:
    """Write summary Markdown report."""
    path = run_dir / "summary.md"

    lines = [
        f"# Review Summary: {run.run_id}",
        "",
        f"**Components reviewed:** {len(run.components_reviewed)}",
        "",
        "## Results",
        "",
        "| Component | Status | Issues | Proposed Invariants |",
        "|-----------|--------|--------|---------------------|",
    ]

    for cid in run.components_reviewed:
        result = run.results.get(cid)
        if result:
            lines.append(
                f"| `{cid}` | {result.status.value} | "
                f"{len(result.issues)} | {len(result.proposed_invariants)} |"
            )

    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")

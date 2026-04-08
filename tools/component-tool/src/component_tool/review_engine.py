"""Review engine - orchestrates component reviews."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .agent_adapter import AgentAdapter
from .graph import resolve_scope
from .models import (
    Component,
    ComponentGraph,
    DependencyContract,
    ReviewResult,
    ReviewRun,
    ReviewStatus,
    ReviewTask,
    compute_fingerprint,
)


def build_review_prompt(
    component: Component,
    scoped_files: list[str],
    components_root: Path,
) -> str:
    """Build the review prompt for a single component."""
    # Read scoped file contents (truncated for very large files)
    file_contents: list[str] = []
    for rel_path in scoped_files:
        abs_path = components_root / rel_path
        if abs_path.is_file():
            try:
                content = abs_path.read_text(encoding="utf-8", errors="replace")
                if len(content) > 50000:
                    content = content[:50000] + "\n... (truncated)"
                file_contents.append(f"### File: {rel_path}\n```\n{content}\n```")
            except Exception:
                file_contents.append(f"### File: {rel_path}\n(could not read)")

    # Format outgoing dependencies as assumptions
    assumptions = []
    for contract in component.outgoing_contracts:
        assumptions.append(
            f"- **{contract.contract_id}**: Depends on `{contract.target_component_id}` — "
            f"{contract.expectation}"
        )

    # Format incoming contracts as obligations
    obligations = []
    for contract in component.incoming_contracts:
        obligations.append(
            f"- **{contract.contract_id}**: Expected by `{contract.source_component_id}` — "
            f"{contract.expectation}"
        )

    prompt = f"""You are reviewing the component `{component.component_id}` ("{component.title}").

## Component Description
{component.description_markdown}

## Scope
Include patterns: {', '.join(f'`{p}`' for p in component.scope.include) or '(none)'}
Exclude patterns: {', '.join(f'`{p}`' for p in component.scope.exclude) or '(none)'}

## Outgoing Dependencies (ASSUMPTIONS — treat these as true)
{chr(10).join(assumptions) if assumptions else '(none)'}

## Incoming Obligations (VERIFY — the component must satisfy these)
{chr(10).join(obligations) if obligations else '(none)'}

## Important Notes
- Scope overlaps with other components are ALLOWED and should not be flagged.
- If the component has outgoing dependencies, assume those external contracts are fulfilled.
- Focus on whether THIS component meets its own description and satisfies its incoming obligations.
- Number issues starting from 1.
- Separately propose missing invariants/dependencies when appropriate.

## Files in Scope
{chr(10).join(file_contents) if file_contents else '(no files in scope)'}

## Required Output
Respond with ONLY a JSON object in this exact schema:

```json
{{
  "component_id": "{component.component_id}",
  "status": "ok | issues_found | blocked",
  "issues": [
    {{
      "issue_id": 1,
      "severity": "high | medium | low",
      "kind": "description_mismatch | obligation_violation | missing_dependency | stale_invariant | scope_problem | other",
      "title": "Short title",
      "details": "Long explanation",
      "evidence": [
        {{
          "path": "relative/file/path.py",
          "lines": "10-42"
        }}
      ],
      "suggested_action": "Suggested fix"
    }}
  ],
  "proposed_invariants": [
    {{
      "source_component_id": "some.component",
      "target_component_id": "other.component",
      "expectation": "What should be guaranteed"
    }}
  ]
}}
```
"""
    return prompt


class ReviewScheduler:
    """Manages the review queue with fingerprint-based deduplication."""

    def __init__(self) -> None:
        self.pending: list[ReviewTask] = []
        self.in_progress: ReviewTask | None = None
        self.completed: dict[str, ReviewResult] = {}
        self._seen_fingerprints: dict[str, str] = {}  # component_id -> fingerprint

    def enqueue(self, task: ReviewTask) -> bool:
        """Add a task to the queue. Returns False if skipped due to same fingerprint."""
        if task.component_id in self._seen_fingerprints:
            if self._seen_fingerprints[task.component_id] == task.fingerprint:
                return False
        self._seen_fingerprints[task.component_id] = task.fingerprint
        self.pending.append(task)
        return True

    def next(self) -> ReviewTask | None:
        """Get the next task to process."""
        if not self.pending:
            return None
        self.in_progress = self.pending.pop(0)
        return self.in_progress

    def complete(self, result: ReviewResult) -> None:
        """Mark the current task as complete."""
        self.completed[result.component_id] = result
        self.in_progress = None

    def requeue(self, component_id: str, reason: str, fingerprint: str) -> bool:
        """Re-enqueue a component for review if its fingerprint changed."""
        task = ReviewTask(
            component_id=component_id,
            reason=reason,
            fingerprint=fingerprint,
        )
        return self.enqueue(task)


def compute_component_fingerprint(
    component: Component,
    components_root: Path,
    git_root: Path | None = None,
) -> str:
    """Compute a fingerprint for a component's current state."""
    # Read component file
    component_content = component.file_path.read_text(encoding="utf-8")

    # Hash scoped files
    scoped_files = resolve_scope(component.scope, components_root, git_root=git_root)
    file_hashes: dict[str, str] = {}
    for rel_path in scoped_files:
        abs_path = components_root / rel_path
        if abs_path.is_file():
            content = abs_path.read_bytes()
            file_hashes[rel_path] = hashlib.sha256(content).hexdigest()

    return compute_fingerprint(
        component_content, file_hashes,
        component.incoming_contracts, component.outgoing_contracts,
    )


def run_single_review(
    component: Component,
    graph: ComponentGraph,
    components_root: Path,
    adapter: AgentAdapter,
    git_root: Path | None = None,
    timeout_sec: int = 300,
) -> ReviewResult:
    """Run a review for a single component."""
    scoped_files = resolve_scope(component.scope, components_root, git_root=git_root)
    prompt = build_review_prompt(component, scoped_files, components_root)

    result = adapter.run_review(prompt, components_root, timeout_sec)

    if result.parsed_json:
        try:
            return ReviewResult(
                component_id=component.component_id,
                status=ReviewStatus(result.parsed_json.get("status", "ok")),
                issues=[
                    _parse_issue(i) for i in result.parsed_json.get("issues", [])
                ],
                proposed_invariants=[
                    _parse_invariant(i) for i in result.parsed_json.get("proposed_invariants", [])
                ],
                raw_agent_output=result.raw_output,
            )
        except Exception:
            pass

    # Fallback: couldn't parse structured output
    return ReviewResult(
        component_id=component.component_id,
        status=ReviewStatus.BLOCKED,
        raw_agent_output=result.raw_output,
    )


def _parse_issue(data: dict) -> "ReviewResult":
    """Parse an issue dict from agent output."""
    from .models import Evidence, IssueKind, IssueSeverity, ReviewIssue

    return ReviewIssue(
        issue_id=data.get("issue_id", 0),
        severity=IssueSeverity(data.get("severity", "low")),
        kind=IssueKind(data.get("kind", "other")),
        title=data.get("title", ""),
        details=data.get("details", ""),
        evidence=[
            Evidence(path=e.get("path", ""), lines=e.get("lines", ""))
            for e in data.get("evidence", [])
        ],
        suggested_action=data.get("suggested_action", ""),
    )


def _parse_invariant(data: dict) -> "ReviewResult":
    """Parse a proposed invariant from agent output."""
    from .models import ProposedInvariant

    return ProposedInvariant(
        source_component_id=data.get("source_component_id", ""),
        target_component_id=data.get("target_component_id", ""),
        expectation=data.get("expectation", ""),
    )


def get_changed_files(git_root: Path) -> list[str]:
    """Get all changed files (staged, unstaged, untracked non-ignored)."""
    files: set[str] = set()

    try:
        # Staged changes
        result = subprocess.run(
            ["git", "diff", "--name-only", "--cached"],
            cwd=str(git_root),
            capture_output=True, text=True, check=True,
        )
        for line in result.stdout.strip().split("\n"):
            if line:
                files.add(line)

        # Unstaged changes
        result = subprocess.run(
            ["git", "diff", "--name-only"],
            cwd=str(git_root),
            capture_output=True, text=True, check=True,
        )
        for line in result.stdout.strip().split("\n"):
            if line:
                files.add(line)

        # Untracked non-ignored files
        result = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            cwd=str(git_root),
            capture_output=True, text=True, check=True,
        )
        for line in result.stdout.strip().split("\n"):
            if line:
                files.add(line)

    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    return sorted(files)


def resolve_affected_components(
    changed_files: list[str],
    graph: ComponentGraph,
    components_root: Path,
    git_root: Path | None = None,
) -> set[str]:
    """Determine which components are affected by the given changed files."""
    affected: set[str] = set()

    root_resolved = components_root.resolve()
    git_root_resolved = git_root.resolve() if git_root else root_resolved

    for changed_file in changed_files:
        abs_path = git_root_resolved / changed_file

        # Check if it's a component file itself
        if changed_file.endswith(".component.md"):
            for cid, comp in graph.components.items():
                if comp.file_path.resolve() == abs_path.resolve():
                    affected.add(cid)
                    break

        # Check if it falls within any component's scope
        try:
            rel_to_root = str(abs_path.relative_to(root_resolved))
        except ValueError:
            continue

        if rel_to_root in graph.file_to_components:
            for cid in graph.file_to_components[rel_to_root]:
                affected.add(cid)

    return affected

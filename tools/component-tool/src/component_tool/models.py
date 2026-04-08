"""Core Pydantic models for the component tool."""

from __future__ import annotations

import hashlib
import json
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


class ScopeSpec(BaseModel):
    """Scope specification with include/exclude glob patterns."""

    include: list[str] = Field(default_factory=list)
    exclude: list[str] = Field(default_factory=list)


class DependencyEntry(BaseModel):
    """A single dependency or dependant entry in a component file's frontmatter."""

    contract_id: str
    target_component_id: str | None = None
    target_path: str | None = None
    source_component_id: str | None = None
    source_path: str | None = None
    expectation: str


class ComponentFrontmatter(BaseModel):
    """Structured data from a .component.md file's YAML frontmatter."""

    schema_version: int = 1
    component_id: str
    title: str
    scope: ScopeSpec = Field(default_factory=ScopeSpec)
    dependencies: list[DependencyEntry] = Field(default_factory=list)
    dependants: list[DependencyEntry] = Field(default_factory=list)


class DependencyContract(BaseModel):
    """A first-class contract between two components."""

    contract_id: str
    source_component_id: str
    target_component_id: str
    expectation: str
    source_file: Path
    target_file: Path


class Component(BaseModel):
    """A fully resolved component with all metadata."""

    component_id: str
    title: str
    file_path: Path
    description_markdown: str = ""
    scope: ScopeSpec = Field(default_factory=ScopeSpec)
    outgoing_contracts: list[DependencyContract] = Field(default_factory=list)
    incoming_contracts: list[DependencyContract] = Field(default_factory=list)


class ComponentGraph(BaseModel):
    """The full graph of components and their contracts."""

    components: dict[str, Component] = Field(default_factory=dict)
    contracts: dict[str, DependencyContract] = Field(default_factory=dict)

    # Reverse indexes
    dependants_of: dict[str, list[str]] = Field(default_factory=dict)
    dependencies_of: dict[str, list[str]] = Field(default_factory=dict)

    # File-to-components scope index (str keys for JSON compat)
    file_to_components: dict[str, list[str]] = Field(default_factory=dict)


class ValidationSeverity(str, Enum):
    ERROR = "error"
    WARNING = "warning"


class ValidationIssue(BaseModel):
    """A single validation issue found during graph validation."""

    severity: ValidationSeverity
    message: str
    file_path: Path | None = None
    component_id: str | None = None
    contract_id: str | None = None


class IssueSeverity(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class IssueKind(str, Enum):
    DESCRIPTION_MISMATCH = "description_mismatch"
    OBLIGATION_VIOLATION = "obligation_violation"
    MISSING_DEPENDENCY = "missing_dependency"
    STALE_INVARIANT = "stale_invariant"
    SCOPE_PROBLEM = "scope_problem"
    OTHER = "other"


class Evidence(BaseModel):
    """Evidence location for a review issue."""

    path: str
    lines: str = ""


class ReviewIssue(BaseModel):
    """A single issue found during review."""

    issue_id: int
    severity: IssueSeverity
    kind: IssueKind
    title: str
    details: str
    evidence: list[Evidence] = Field(default_factory=list)
    suggested_action: str = ""


class ProposedInvariant(BaseModel):
    """A proposed new dependency contract."""

    source_component_id: str
    target_component_id: str
    expectation: str


class ReviewStatus(str, Enum):
    OK = "ok"
    ISSUES_FOUND = "issues_found"
    BLOCKED = "blocked"


class ReviewResult(BaseModel):
    """Result of reviewing a single component."""

    component_id: str
    status: ReviewStatus
    issues: list[ReviewIssue] = Field(default_factory=list)
    proposed_invariants: list[ProposedInvariant] = Field(default_factory=list)
    raw_agent_output: str = ""


class ReviewTask(BaseModel):
    """A queued review task."""

    component_id: str
    reason: str
    fingerprint: str = ""


class ReviewRun(BaseModel):
    """Metadata for a complete review run."""

    run_id: str
    components_reviewed: list[str] = Field(default_factory=list)
    results: dict[str, ReviewResult] = Field(default_factory=dict)


def compute_fingerprint(
    component_file_content: str,
    scoped_file_hashes: dict[str, str],
    incoming_contracts: list[DependencyContract],
    outgoing_contracts: list[DependencyContract],
) -> str:
    """Compute a fingerprint for a component's review-relevant inputs."""
    data: dict[str, Any] = {
        "component_file": hashlib.sha256(component_file_content.encode()).hexdigest(),
        "scoped_files": dict(sorted(scoped_file_hashes.items())),
        "incoming": sorted(
            [c.model_dump(mode="json") for c in incoming_contracts],
            key=lambda x: x["contract_id"],
        ),
        "outgoing": sorted(
            [c.model_dump(mode="json") for c in outgoing_contracts],
            key=lambda x: x["contract_id"],
        ),
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()

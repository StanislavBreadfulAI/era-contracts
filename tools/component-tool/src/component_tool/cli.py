"""CLI entry point using Typer."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.console import Console
from rich.table import Table

from .agent_adapter import ClaudeAdapter, CodexAdapter
from .editor import add_dependency, create_component_file
from .graph import build_graph, resolve_scope
from .models import (
    ComponentGraph,
    ReviewResult,
    ReviewRun,
    ReviewStatus,
    ReviewTask,
    ValidationSeverity,
)
from .report_writer import write_reports
from .review_engine import (
    ReviewScheduler,
    compute_component_fingerprint,
    get_changed_files,
    resolve_affected_components,
    run_single_review,
)
from .scanner import find_git_root
from .validator import validate_graph

app = typer.Typer(
    name="component-tool",
    help="CLI tool for managing and reviewing conceptual components described by .component.md files.",
    no_args_is_help=True,
)
console = Console()
err_console = Console(stderr=True)


def _resolve_roots(workspace: Path) -> tuple[Path, Path | None, Path]:
    """Resolve workspace_root, git_root, and components_root."""
    workspace_root = workspace.resolve()
    git_root = find_git_root(workspace_root)
    components_root = workspace_root  # For now, same as workspace_root
    return workspace_root, git_root, components_root


def _load_and_validate(
    components_root: Path,
    git_root: Path | None,
    fail_on_error: bool = True,
) -> ComponentGraph:
    """Load the component graph and run validation. Exit on errors if fail_on_error."""
    graph = build_graph(components_root, git_root)
    issues = validate_graph(graph, components_root, git_root)

    errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
    warnings = [i for i in issues if i.severity == ValidationSeverity.WARNING]

    for w in warnings:
        err_console.print(f"[yellow]WARNING:[/yellow] {w.message}")

    if errors:
        for e in errors:
            err_console.print(f"[red]ERROR:[/red] {e.message}")
        if fail_on_error:
            raise typer.Exit(code=1)

    return graph


def _find_component(graph: ComponentGraph, comp_id: str) -> str:
    """Find a component by exact ID or prefix match. Returns the component_id."""
    if comp_id in graph.components:
        return comp_id

    # Try prefix match
    matches = [cid for cid in graph.components if cid.startswith(comp_id)]
    if len(matches) == 1:
        return matches[0]
    elif len(matches) > 1:
        err_console.print(
            f"[red]Ambiguous component '{comp_id}'. Matches: {', '.join(matches)}[/red]"
        )
        raise typer.Exit(code=1)
    else:
        err_console.print(f"[red]Component '{comp_id}' not found.[/red]")
        raise typer.Exit(code=1)


# ─── list_all ────────────────────────────────────────────────────────────────

@app.command("list-all")
def list_all(
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """List all components and their outgoing dependencies."""
    workspace_root, git_root, components_root = _resolve_roots(workspace)
    graph = _load_and_validate(components_root, git_root, fail_on_error=False)

    if not graph.components:
        err_console.print("[yellow]No components found.[/yellow]")
        raise typer.Exit(code=0)

    if as_json:
        data = []
        for cid in sorted(graph.components):
            comp = graph.components[cid]
            data.append({
                "component_id": cid,
                "title": comp.title,
                "file_path": str(comp.file_path),
                "scope": comp.scope.model_dump(),
                "dependencies": [
                    {
                        "contract_id": c.contract_id,
                        "target": c.target_component_id,
                        "expectation": c.expectation,
                    }
                    for c in comp.outgoing_contracts
                ],
                "dependant_count": len(comp.incoming_contracts),
            })
        print(json.dumps(data, indent=2))
        return

    table = Table(title="Components")
    table.add_column("ID", style="cyan")
    table.add_column("Title")
    table.add_column("Path", style="dim")
    table.add_column("Scope")
    table.add_column("Deps", justify="right")
    table.add_column("Dependants", justify="right")

    for cid in sorted(graph.components):
        comp = graph.components[cid]
        scope_summary = ", ".join(comp.scope.include[:3])
        if len(comp.scope.include) > 3:
            scope_summary += "..."
        table.add_row(
            cid,
            comp.title,
            str(comp.file_path),
            scope_summary or "(none)",
            str(len(comp.outgoing_contracts)),
            str(len(comp.incoming_contracts)),
        )

    console.print(table)


# ─── list_deps ───────────────────────────────────────────────────────────────

@app.command("list-deps")
def list_deps(
    comp1: Annotated[str, typer.Argument(help="Component ID")],
    comp2: Annotated[Optional[str], typer.Argument(help="Optional second component ID to filter")] = None,
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Show outgoing contracts for a component, optionally filtered by target."""
    workspace_root, git_root, components_root = _resolve_roots(workspace)
    graph = _load_and_validate(components_root, git_root, fail_on_error=False)

    cid1 = _find_component(graph, comp1)
    comp = graph.components[cid1]

    contracts = comp.outgoing_contracts
    if comp2:
        cid2 = _find_component(graph, comp2)
        contracts = [c for c in contracts if c.target_component_id == cid2]

    if not contracts:
        if comp2:
            err_console.print(f"No contracts from '{cid1}' to '{comp2}'.")
        else:
            err_console.print(f"No outgoing contracts for '{cid1}'.")
        raise typer.Exit(code=1)

    if as_json:
        data = [
            {
                "contract_id": c.contract_id,
                "source": c.source_component_id,
                "target": c.target_component_id,
                "expectation": c.expectation,
            }
            for c in contracts
        ]
        print(json.dumps(data, indent=2))
        return

    table = Table(title=f"Dependencies of {cid1}")
    table.add_column("Contract ID", style="cyan")
    table.add_column("Target", style="green")
    table.add_column("Expectation")

    for c in contracts:
        table.add_row(c.contract_id, c.target_component_id, c.expectation)

    console.print(table)


# ─── add_comp ────────────────────────────────────────────────────────────────

@app.command("add-comp")
def add_comp(
    file_path: Annotated[str, typer.Argument(help="Relative path for the new .component.md file")],
    component_id: Annotated[str, typer.Option("--id", help="Component ID")] = "",
    title: Annotated[str, typer.Option("--title", help="Component title")] = "",
    scope: Annotated[Optional[list[str]], typer.Option("--scope", help="Scope include glob(s)")] = None,
    scope_exclude: Annotated[Optional[list[str]], typer.Option("--scope-exclude", help="Scope exclude glob(s)")] = None,
    description: Annotated[str, typer.Option("--description", help="Component description")] = "",
    force: Annotated[bool, typer.Option("--force", help="Overwrite existing file")] = False,
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
) -> None:
    """Create a new .component.md file."""
    workspace_root, _, _ = _resolve_roots(workspace)

    if not file_path.endswith(".component.md"):
        file_path += ".component.md"

    abs_path = (workspace_root / file_path).resolve()

    # Ensure path is within workspace
    try:
        abs_path.relative_to(workspace_root)
    except ValueError:
        err_console.print("[red]File path resolves outside workspace root.[/red]")
        raise typer.Exit(code=1)

    if not component_id:
        # Derive from filename
        component_id = abs_path.stem.replace(".component", "").replace("/", ".").replace("\\", ".")

    if not title:
        title = component_id.replace(".", " ").replace("_", " ").title()

    try:
        created = create_component_file(
            file_path=abs_path,
            component_id=component_id,
            title=title,
            scope_include=scope,
            scope_exclude=scope_exclude,
            description=description,
            force=force,
        )
        console.print(f"[green]Created component file:[/green] {created}")
    except FileExistsError as e:
        err_console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1)


# ─── add_dep ─────────────────────────────────────────────────────────────────

@app.command("add-dep")
def add_dep(
    comp1: Annotated[str, typer.Argument(help="Source component ID")],
    comp2: Annotated[str, typer.Argument(help="Target component ID")],
    expectation: Annotated[str, typer.Argument(help="Expectation text for the contract")],
    contract_id: Annotated[Optional[str], typer.Option("--contract-id", help="Explicit contract ID")] = None,
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
) -> None:
    """Add a dependency contract between two components."""
    workspace_root, git_root, components_root = _resolve_roots(workspace)
    graph = _load_and_validate(components_root, git_root, fail_on_error=True)

    cid1 = _find_component(graph, comp1)
    cid2 = _find_component(graph, comp2)

    source = graph.components[cid1]
    target = graph.components[cid2]

    try:
        used_id = add_dependency(
            source_file=source.file_path,
            target_file=target.file_path,
            expectation=expectation,
            contract_id=contract_id,
            components_root=components_root,
        )
        console.print(
            f"[green]Added contract '{used_id}':[/green] "
            f"{cid1} -> {cid2}"
        )
    except ValueError as e:
        err_console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1)


# ─── review ──────────────────────────────────────────────────────────────────

@app.command("review")
def review(
    components: Annotated[list[str], typer.Argument(help="Component ID(s) to review")],
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
    agent: Annotated[str, typer.Option("--agent", help="Agent to use: claude, codex")] = "claude",
    model: Annotated[str, typer.Option("--model", help="Model to use (for claude adapter)")] = "sonnet",
    timeout: Annotated[int, typer.Option("--timeout", help="Timeout per review in seconds")] = 300,
    output_dir: Annotated[Path, typer.Option("--output", "-o", help="Output directory for reports")] = Path(".component-tool/reviews"),
) -> None:
    """Review one or more components."""
    workspace_root, git_root, components_root = _resolve_roots(workspace)
    graph = _load_and_validate(components_root, git_root, fail_on_error=True)

    adapter = _make_adapter(agent, model)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    resolved_ids = [_find_component(graph, c) for c in components]
    run = _run_reviews(resolved_ids, graph, components_root, git_root, adapter, timeout, run_id)

    abs_output = (components_root / output_dir).resolve()
    run_dir = write_reports(run, abs_output)
    console.print(f"\n[green]Reports written to:[/green] {run_dir}")
    _print_summary(run)


# ─── review_all ──────────────────────────────────────────────────────────────

@app.command("review-all")
def review_all(
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Skip confirmation prompt")] = False,
    agent: Annotated[str, typer.Option("--agent", help="Agent to use: claude, codex")] = "claude",
    model: Annotated[str, typer.Option("--model", help="Model to use")] = "sonnet",
    timeout: Annotated[int, typer.Option("--timeout", help="Timeout per review in seconds")] = 300,
    output_dir: Annotated[Path, typer.Option("--output", "-o", help="Output directory for reports")] = Path(".component-tool/reviews"),
) -> None:
    """Review ALL components. Requires --yes in non-interactive mode."""
    workspace_root, git_root, components_root = _resolve_roots(workspace)
    graph = _load_and_validate(components_root, git_root, fail_on_error=True)

    count = len(graph.components)
    if count == 0:
        err_console.print("[yellow]No components found.[/yellow]")
        raise typer.Exit(code=0)

    if not yes:
        err_console.print(
            f"[bold yellow]WARNING:[/bold yellow] This will review ALL {count} components. "
            f"This may take a long time and consume significant API credits."
        )
        confirm = typer.confirm("Continue?")
        if not confirm:
            raise typer.Abort()

    adapter = _make_adapter(agent, model)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    all_ids = sorted(graph.components.keys())
    run = _run_reviews(all_ids, graph, components_root, git_root, adapter, timeout, run_id)

    abs_output = (components_root / output_dir).resolve()
    run_dir = write_reports(run, abs_output)
    console.print(f"\n[green]Reports written to:[/green] {run_dir}")
    _print_summary(run)


# ─── review_diff ─────────────────────────────────────────────────────────────

@app.command("review-diff")
def review_diff(
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
    agent: Annotated[str, typer.Option("--agent", help="Agent to use: claude, codex")] = "claude",
    model: Annotated[str, typer.Option("--model", help="Model to use")] = "sonnet",
    timeout: Annotated[int, typer.Option("--timeout", help="Timeout per review in seconds")] = 300,
    output_dir: Annotated[Path, typer.Option("--output", "-o", help="Output directory for reports")] = Path(".component-tool/reviews"),
) -> None:
    """Review components affected by current git changes."""
    workspace_root, git_root, components_root = _resolve_roots(workspace)

    if not git_root:
        err_console.print("[red]Not inside a git repository.[/red]")
        raise typer.Exit(code=1)

    graph = _load_and_validate(components_root, git_root, fail_on_error=True)

    changed_files = get_changed_files(git_root)
    if not changed_files:
        console.print("[yellow]No changed files detected.[/yellow]")
        raise typer.Exit(code=0)

    affected = resolve_affected_components(changed_files, graph, components_root, git_root)

    # Warn about files owned by no component
    all_scoped: set[str] = set()
    for file_list in graph.file_to_components.values():
        all_scoped.add(file_list[0] if file_list else "")
    for f in changed_files:
        root_resolved = components_root.resolve()
        git_root_resolved = git_root.resolve()
        abs_path = git_root_resolved / f
        try:
            rel = str(abs_path.relative_to(root_resolved))
        except ValueError:
            continue
        if rel not in graph.file_to_components and not f.endswith(".component.md"):
            err_console.print(f"[yellow]WARNING:[/yellow] Changed file '{f}' belongs to no component")

    if not affected:
        console.print("[yellow]No components affected by current changes.[/yellow]")
        raise typer.Exit(code=0)

    console.print(f"[bold]Affected components ({len(affected)}):[/bold]")
    for cid in sorted(affected):
        console.print(f"  - {cid}")
    console.print()

    adapter = _make_adapter(agent, model)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    run = _run_reviews(
        sorted(affected), graph, components_root, git_root, adapter, timeout, run_id
    )

    abs_output = (components_root / output_dir).resolve()
    run_dir = write_reports(run, abs_output)
    console.print(f"\n[green]Reports written to:[/green] {run_dir}")
    _print_summary(run)


# ─── validate ────────────────────────────────────────────────────────────────

@app.command("validate")
def validate(
    workspace: Annotated[Path, typer.Option("--workspace", "-w", help="Workspace root directory")] = Path("."),
    as_json: Annotated[bool, typer.Option("--json", help="Output as JSON")] = False,
) -> None:
    """Validate all component files and their invariants."""
    workspace_root, git_root, components_root = _resolve_roots(workspace)
    graph = build_graph(components_root, git_root)
    issues = validate_graph(graph, components_root, git_root)

    if as_json:
        data = [i.model_dump(mode="json") for i in issues]
        print(json.dumps(data, indent=2))
    else:
        if not issues:
            console.print("[green]All validations passed.[/green]")
        else:
            errors = [i for i in issues if i.severity == ValidationSeverity.ERROR]
            warnings = [i for i in issues if i.severity == ValidationSeverity.WARNING]
            for w in warnings:
                console.print(f"[yellow]WARNING:[/yellow] {w.message}")
            for e in errors:
                console.print(f"[red]ERROR:[/red] {e.message}")
            console.print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")

    if any(i.severity == ValidationSeverity.ERROR for i in issues):
        raise typer.Exit(code=1)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_adapter(agent: str, model: str):
    """Create the appropriate agent adapter."""
    if agent == "claude":
        return ClaudeAdapter(model=model)
    elif agent == "codex":
        return CodexAdapter()
    else:
        err_console.print(f"[red]Unknown agent: {agent}. Use 'claude' or 'codex'.[/red]")
        raise typer.Exit(code=1)


def _run_reviews(
    component_ids: list[str],
    graph: ComponentGraph,
    components_root: Path,
    git_root: Path | None,
    adapter,
    timeout: int,
    run_id: str,
) -> ReviewRun:
    """Run sequential reviews for the given components."""
    scheduler = ReviewScheduler()

    for cid in component_ids:
        comp = graph.components[cid]
        fp = compute_component_fingerprint(comp, components_root, git_root)
        scheduler.enqueue(ReviewTask(
            component_id=cid,
            reason="requested",
            fingerprint=fp,
        ))

    run = ReviewRun(run_id=run_id)

    while True:
        task = scheduler.next()
        if task is None:
            break

        comp = graph.components[task.component_id]
        console.print(f"[bold]Reviewing:[/bold] {task.component_id} ({comp.title})...")

        result = run_single_review(
            comp, graph, components_root, adapter, git_root, timeout
        )

        scheduler.complete(result)
        run.components_reviewed.append(task.component_id)
        run.results[task.component_id] = result

        status_color = "green" if result.status == ReviewStatus.OK else "red"
        console.print(
            f"  [{status_color}]{result.status.value}[/{status_color}] "
            f"— {len(result.issues)} issue(s)"
        )

    return run


def _print_summary(run: ReviewRun) -> None:
    """Print a summary table of the review run."""
    table = Table(title="Review Summary")
    table.add_column("Component", style="cyan")
    table.add_column("Status")
    table.add_column("Issues", justify="right")
    table.add_column("Proposed Invariants", justify="right")

    for cid in run.components_reviewed:
        result = run.results.get(cid)
        if result:
            status_color = "green" if result.status == ReviewStatus.OK else "red"
            table.add_row(
                cid,
                f"[{status_color}]{result.status.value}[/{status_color}]",
                str(len(result.issues)),
                str(len(result.proposed_invariants)),
            )

    console.print(table)


def app_main() -> None:
    """Entry point for the CLI."""
    app()

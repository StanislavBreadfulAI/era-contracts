#!/usr/bin/env node

/**
 * CLI entry point using Commander.
 */

import { resolve, relative as relPath } from "path";
import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";

import type { AgentAdapter } from "./agentAdapter.js";
import { ClaudeAdapter, CodexAdapter } from "./agentAdapter.js";
import { createComponentFile, addDependency } from "./editor.js";
import { buildGraph, resolveScope } from "./graph.js";
import type { ComponentGraph, ReviewResult, ReviewRun, ReviewTask } from "./models.js";
import { writeReports } from "./reportWriter.js";
import {
  ReviewScheduler,
  computeComponentFingerprint,
  getChangedFiles,
  resolveAffectedComponents,
  runSingleReview,
} from "./reviewEngine.js";
import { findGitRoot } from "./scanner.js";
import { validateGraph } from "./validator.js";

const program = new Command();

program
  .name("component-tool")
  .description(
    "CLI tool for managing and reviewing conceptual components described by .component.md files.",
  )
  .version("0.1.0");

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveRoots(workspace: string): {
  workspaceRoot: string;
  gitRoot: string | null;
  componentsRoot: string;
} {
  const workspaceRoot = resolve(workspace);
  const gitRoot = findGitRoot(workspaceRoot);
  return { workspaceRoot, gitRoot, componentsRoot: workspaceRoot };
}

function loadAndValidate(
  componentsRoot: string,
  gitRoot: string | null,
  failOnError: boolean = true,
): ComponentGraph {
  const graph = buildGraph(componentsRoot, gitRoot);
  const issues = validateGraph(graph, componentsRoot, gitRoot);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  for (const w of warnings) {
    console.error(chalk.yellow("WARNING:"), w.message);
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(chalk.red("ERROR:"), e.message);
    }
    if (failOnError) process.exit(1);
  }

  return graph;
}

function findComponent(graph: ComponentGraph, compId: string): string {
  if (graph.components[compId]) return compId;

  const matches = Object.keys(graph.components).filter((cid) =>
    cid.startsWith(compId),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.error(
      chalk.red(
        `Ambiguous component '${compId}'. Matches: ${matches.join(", ")}`,
      ),
    );
    process.exit(1);
  }
  console.error(chalk.red(`Component '${compId}' not found.`));
  process.exit(1);
}

function makeAdapter(agent: string, model: string): AgentAdapter {
  if (agent === "claude") return new ClaudeAdapter(model);
  if (agent === "codex") return new CodexAdapter();
  console.error(chalk.red(`Unknown agent: ${agent}. Use 'claude' or 'codex'.`));
  process.exit(1);
}

function runReviews(
  componentIds: string[],
  graph: ComponentGraph,
  componentsRoot: string,
  gitRoot: string | null,
  adapter: AgentAdapter,
  timeout: number,
  runId: string,
): ReviewRun {
  const scheduler = new ReviewScheduler();

  for (const cid of componentIds) {
    const comp = graph.components[cid];
    const fp = computeComponentFingerprint(comp, componentsRoot, gitRoot);
    scheduler.enqueue({ component_id: cid, reason: "requested", fingerprint: fp });
  }

  const run: ReviewRun = {
    run_id: runId,
    components_reviewed: [],
    results: {},
  };

  let task: ReviewTask | null;
  while ((task = scheduler.next()) !== null) {
    const comp = graph.components[task.component_id];
    console.log(chalk.bold(`Reviewing: ${task.component_id} (${comp.title})...`));

    const result = runSingleReview(
      comp,
      graph,
      componentsRoot,
      adapter,
      gitRoot,
      timeout,
    );

    scheduler.complete(result);
    run.components_reviewed.push(task.component_id);
    run.results[task.component_id] = result;

    const statusColor = result.status === "ok" ? chalk.green : chalk.red;
    console.log(
      `  ${statusColor(result.status)} — ${result.issues.length} issue(s)`,
    );
  }

  return run;
}

function printSummary(run: ReviewRun): void {
  const table = new Table({
    head: ["Component", "Status", "Issues", "Proposed Invariants"],
  });

  for (const cid of run.components_reviewed) {
    const result = run.results[cid];
    if (result) {
      table.push([
        cid,
        result.status,
        String(result.issues.length),
        String(result.proposed_invariants.length),
      ]);
    }
  }

  console.log("\nReview Summary");
  console.log(table.toString());
}

function getRunId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

// ─── Commands ───────────────────────────────────────────────────────────────

program
  .command("list-all")
  .description("List all components and their outgoing dependencies.")
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const { componentsRoot, gitRoot } = resolveRoots(opts.workspace);
    const graph = loadAndValidate(componentsRoot, gitRoot, false);

    const ids = Object.keys(graph.components).sort();
    if (ids.length === 0) {
      console.error(chalk.yellow("No components found."));
      return;
    }

    if (opts.json) {
      const data = ids.map((cid) => {
        const comp = graph.components[cid];
        return {
          component_id: cid,
          title: comp.title,
          file_path: comp.file_path,
          scope: comp.scope,
          dependencies: comp.outgoing_contracts.map((c) => ({
            contract_id: c.contract_id,
            target: c.target_component_id,
            expectation: c.expectation,
          })),
          dependant_count: comp.incoming_contracts.length,
        };
      });
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const table = new Table({
      head: ["ID", "Title", "Path", "Scope", "Deps", "Dependants"],
    });

    for (const cid of ids) {
      const comp = graph.components[cid];
      let scopeSummary = comp.scope.include.slice(0, 3).join(", ");
      if (comp.scope.include.length > 3) scopeSummary += "...";
      table.push([
        cid,
        comp.title,
        comp.file_path,
        scopeSummary || "(none)",
        String(comp.outgoing_contracts.length),
        String(comp.incoming_contracts.length),
      ]);
    }

    console.log(table.toString());
  });

program
  .command("list-deps <comp1> [comp2]")
  .description(
    "Show outgoing contracts for a component, optionally filtered by target.",
  )
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .option("--json", "Output as JSON")
  .action((comp1: string, comp2: string | undefined, opts) => {
    const { componentsRoot, gitRoot } = resolveRoots(opts.workspace);
    const graph = loadAndValidate(componentsRoot, gitRoot, false);

    const cid1 = findComponent(graph, comp1);
    let contracts = graph.components[cid1].outgoing_contracts;

    if (comp2) {
      const cid2 = findComponent(graph, comp2);
      contracts = contracts.filter((c) => c.target_component_id === cid2);
    }

    if (contracts.length === 0) {
      console.error(
        comp2
          ? `No contracts from '${cid1}' to '${comp2}'.`
          : `No outgoing contracts for '${cid1}'.`,
      );
      process.exit(1);
    }

    if (opts.json) {
      const data = contracts.map((c) => ({
        contract_id: c.contract_id,
        source: c.source_component_id,
        target: c.target_component_id,
        expectation: c.expectation,
      }));
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const table = new Table({
      head: ["Contract ID", "Target", "Expectation"],
    });
    for (const c of contracts) {
      table.push([c.contract_id, c.target_component_id, c.expectation]);
    }
    console.log(`Dependencies of ${cid1}`);
    console.log(table.toString());
  });

program
  .command("add-comp <file-path>")
  .description("Create a new .component.md file.")
  .option("--id <id>", "Component ID")
  .option("--title <title>", "Component title")
  .option("--scope <glob...>", "Scope include glob(s)")
  .option("--scope-exclude <glob...>", "Scope exclude glob(s)")
  .option("--description <text>", "Component description")
  .option("--force", "Overwrite existing file")
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .action((filePath: string, opts) => {
    const { workspaceRoot } = resolveRoots(opts.workspace);

    if (!filePath.endsWith(".component.md")) {
      filePath += ".component.md";
    }

    const absPath = resolve(workspaceRoot, filePath);
    if (!absPath.startsWith(workspaceRoot)) {
      console.error(chalk.red("File path resolves outside workspace root."));
      process.exit(1);
    }

    const componentId =
      opts.id || absPath.split("/").pop()!.replace(".component.md", "").replace(/[/\\]/g, ".");
    const title =
      opts.title ||
      componentId
        .replace(/\./g, " ")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());

    try {
      const created = createComponentFile({
        filePath: absPath,
        componentId,
        title,
        scopeInclude: opts.scope,
        scopeExclude: opts.scopeExclude,
        description: opts.description,
        force: opts.force,
      });
      console.log(chalk.green("Created component file:"), created);
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

program
  .command("add-dep <comp1> <comp2> <expectation>")
  .description("Add a dependency contract between two components.")
  .option("--contract-id <id>", "Explicit contract ID")
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .action((comp1: string, comp2: string, expectation: string, opts) => {
    const { componentsRoot, gitRoot } = resolveRoots(opts.workspace);
    const graph = loadAndValidate(componentsRoot, gitRoot, true);

    const cid1 = findComponent(graph, comp1);
    const cid2 = findComponent(graph, comp2);
    const source = graph.components[cid1];
    const target = graph.components[cid2];

    try {
      const usedId = addDependency({
        sourceFile: source.file_path,
        targetFile: target.file_path,
        expectation,
        contractId: opts.contractId,
      });
      console.log(
        chalk.green(`Added contract '${usedId}':`),
        `${cid1} -> ${cid2}`,
      );
    } catch (err: unknown) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

program
  .command("review <components...>")
  .description("Review one or more components.")
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .option("--agent <agent>", "Agent to use: claude, codex", "claude")
  .option("--model <model>", "Model to use", "sonnet")
  .option("--timeout <seconds>", "Timeout per review in seconds", "300")
  .option(
    "-o, --output <path>",
    "Output directory for reports",
    ".component-tool/reviews",
  )
  .action((components: string[], opts) => {
    const { componentsRoot, gitRoot } = resolveRoots(opts.workspace);
    const graph = loadAndValidate(componentsRoot, gitRoot, true);

    const adapter = makeAdapter(opts.agent, opts.model);
    const runId = getRunId();
    const resolvedIds = components.map((c: string) => findComponent(graph, c));
    const run = runReviews(
      resolvedIds,
      graph,
      componentsRoot,
      gitRoot,
      adapter,
      parseInt(opts.timeout),
      runId,
    );

    const absOutput = resolve(componentsRoot, opts.output);
    const runDir = writeReports(run, absOutput);
    console.log(chalk.green("\nReports written to:"), runDir);
    printSummary(run);
  });

program
  .command("review-all")
  .description("Review ALL components. Requires --yes in non-interactive mode.")
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--agent <agent>", "Agent to use: claude, codex", "claude")
  .option("--model <model>", "Model to use", "sonnet")
  .option("--timeout <seconds>", "Timeout per review in seconds", "300")
  .option(
    "-o, --output <path>",
    "Output directory for reports",
    ".component-tool/reviews",
  )
  .action(async (opts) => {
    const { componentsRoot, gitRoot } = resolveRoots(opts.workspace);
    const graph = loadAndValidate(componentsRoot, gitRoot, true);

    const ids = Object.keys(graph.components).sort();
    if (ids.length === 0) {
      console.error(chalk.yellow("No components found."));
      return;
    }

    if (!opts.yes) {
      console.error(
        chalk.bold.yellow("WARNING:"),
        `This will review ALL ${ids.length} components. ` +
          "This may take a long time and consume significant API credits.",
      );
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      const answer = await new Promise<string>((res) =>
        rl.question("Continue? [y/N] ", res),
      );
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.error("Aborted.");
        process.exit(1);
      }
    }

    const adapter = makeAdapter(opts.agent, opts.model);
    const runId = getRunId();
    const run = runReviews(
      ids,
      graph,
      componentsRoot,
      gitRoot,
      adapter,
      parseInt(opts.timeout),
      runId,
    );

    const absOutput = resolve(componentsRoot, opts.output);
    const runDir = writeReports(run, absOutput);
    console.log(chalk.green("\nReports written to:"), runDir);
    printSummary(run);
  });

program
  .command("review-diff")
  .description("Review components affected by current git changes.")
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .option("--agent <agent>", "Agent to use: claude, codex", "claude")
  .option("--model <model>", "Model to use", "sonnet")
  .option("--timeout <seconds>", "Timeout per review in seconds", "300")
  .option(
    "-o, --output <path>",
    "Output directory for reports",
    ".component-tool/reviews",
  )
  .action((opts) => {
    const { componentsRoot, gitRoot } = resolveRoots(opts.workspace);

    if (!gitRoot) {
      console.error(chalk.red("Not inside a git repository."));
      process.exit(1);
    }

    const graph = loadAndValidate(componentsRoot, gitRoot, true);
    const changedFiles = getChangedFiles(gitRoot);

    if (changedFiles.length === 0) {
      console.log(chalk.yellow("No changed files detected."));
      return;
    }

    const affected = resolveAffectedComponents(
      changedFiles,
      graph,
      componentsRoot,
      gitRoot,
    );

    // Warn about files owned by no component
    const rootResolved = resolve(componentsRoot);
    const gitRootResolved = resolve(gitRoot);
    for (const f of changedFiles) {
      const absPath = resolve(gitRootResolved, f);
      const rel = relPath(rootResolved, absPath);
      if (rel.startsWith("..")) continue;
      if (
        !graph.file_to_components[rel] &&
        !f.endsWith(".component.md")
      ) {
        console.error(
          chalk.yellow("WARNING:"),
          `Changed file '${f}' belongs to no component`,
        );
      }
    }

    if (affected.size === 0) {
      console.log(
        chalk.yellow("No components affected by current changes."),
      );
      return;
    }

    const sortedAffected = [...affected].sort();
    console.log(chalk.bold(`Affected components (${affected.size}):`));
    for (const cid of sortedAffected) {
      console.log(`  - ${cid}`);
    }
    console.log();

    const adapter = makeAdapter(opts.agent, opts.model);
    const runId = getRunId();
    const run = runReviews(
      sortedAffected,
      graph,
      componentsRoot,
      gitRoot,
      adapter,
      parseInt(opts.timeout),
      runId,
    );

    const absOutput = resolve(componentsRoot, opts.output);
    const runDir = writeReports(run, absOutput);
    console.log(chalk.green("\nReports written to:"), runDir);
    printSummary(run);
  });

program
  .command("validate")
  .description("Validate all component files and their invariants.")
  .option("-w, --workspace <path>", "Workspace root directory", ".")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const { componentsRoot, gitRoot } = resolveRoots(opts.workspace);
    const graph = buildGraph(componentsRoot, gitRoot);
    const issues = validateGraph(graph, componentsRoot, gitRoot);

    if (opts.json) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      if (issues.length === 0) {
        console.log(chalk.green("All validations passed."));
      } else {
        const errors = issues.filter((i) => i.severity === "error");
        const warnings = issues.filter((i) => i.severity === "warning");
        for (const w of warnings) {
          console.log(chalk.yellow("WARNING:"), w.message);
        }
        for (const e of errors) {
          console.log(chalk.red("ERROR:"), e.message);
        }
        console.log(
          `\n${errors.length} error(s), ${warnings.length} warning(s)`,
        );
      }
    }

    if (issues.some((i) => i.severity === "error")) {
      process.exit(1);
    }
  });

program.parse();

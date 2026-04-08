/**
 * Report writer - generates JSON and Markdown reports from review results.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ReviewResult, ReviewRun } from "./models.js";

function safeFilename(componentId: string): string {
  return componentId.replace(/[/\\]/g, "_");
}

export function writeReports(run: ReviewRun, outputDir: string): string {
  const runDir = join(outputDir, run.run_id);
  mkdirSync(runDir, { recursive: true });

  for (const [cid, result] of Object.entries(run.results)) {
    writeComponentJson(result, runDir);
    writeComponentMd(result, runDir);
    writeComponentRaw(result, runDir);
  }

  writeSummaryJson(run, runDir);
  writeSummaryMd(run, runDir);

  return runDir;
}

function writeComponentJson(result: ReviewResult, runDir: string): void {
  const filename = safeFilename(result.component_id);
  const data = { ...result, raw_agent_output: undefined };
  delete (data as Record<string, unknown>).raw_agent_output;
  writeFileSync(
    join(runDir, `${filename}.json`),
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );
}

function writeComponentMd(result: ReviewResult, runDir: string): void {
  const filename = safeFilename(result.component_id);
  const lines: string[] = [
    `# Review: ${result.component_id}`,
    "",
    `**Status:** ${result.status}`,
    "",
  ];

  if (result.issues.length > 0) {
    lines.push("## Issues", "");
    for (const issue of result.issues) {
      lines.push(
        `### ${issue.issue_id}. [${issue.severity.toUpperCase()}] ${issue.title}`,
        "",
        `**Kind:** ${issue.kind}`,
        "",
        issue.details,
        "",
      );
      if (issue.evidence.length > 0) {
        lines.push("**Evidence:**");
        for (const ev of issue.evidence) {
          const loc = ev.lines ? `${ev.path}:${ev.lines}` : ev.path;
          lines.push(`- \`${loc}\``);
        }
        lines.push("");
      }
      if (issue.suggested_action) {
        lines.push(`**Suggested action:** ${issue.suggested_action}`, "");
      }
    }
  } else {
    lines.push("No issues found.", "");
  }

  if (result.proposed_invariants.length > 0) {
    lines.push("## Proposed Invariants", "");
    for (const inv of result.proposed_invariants) {
      lines.push(
        `- \`${inv.source_component_id}\` -> \`${inv.target_component_id}\`: ${inv.expectation}`,
      );
    }
    lines.push("");
  }

  writeFileSync(join(runDir, `${filename}.md`), lines.join("\n"), "utf-8");
}

function writeComponentRaw(result: ReviewResult, runDir: string): void {
  const filename = safeFilename(result.component_id);
  writeFileSync(
    join(runDir, `${filename}.raw.txt`),
    result.raw_agent_output || "(no raw output)",
    "utf-8",
  );
}

function writeSummaryJson(run: ReviewRun, runDir: string): void {
  const data: Record<string, unknown> = {
    run_id: run.run_id,
    components_reviewed: run.components_reviewed,
    results: {} as Record<string, unknown>,
  };
  for (const [cid, result] of Object.entries(run.results)) {
    (data.results as Record<string, unknown>)[cid] = {
      status: result.status,
      issue_count: result.issues.length,
      proposed_invariant_count: result.proposed_invariants.length,
    };
  }
  writeFileSync(
    join(runDir, "summary.json"),
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );
}

function writeSummaryMd(run: ReviewRun, runDir: string): void {
  const lines: string[] = [
    `# Review Summary: ${run.run_id}`,
    "",
    `**Components reviewed:** ${run.components_reviewed.length}`,
    "",
    "## Results",
    "",
    "| Component | Status | Issues | Proposed Invariants |",
    "|-----------|--------|--------|---------------------|",
  ];

  for (const cid of run.components_reviewed) {
    const result = run.results[cid];
    if (result) {
      lines.push(
        `| \`${cid}\` | ${result.status} | ${result.issues.length} | ${result.proposed_invariants.length} |`,
      );
    }
  }

  lines.push("");
  writeFileSync(join(runDir, "summary.md"), lines.join("\n"), "utf-8");
}

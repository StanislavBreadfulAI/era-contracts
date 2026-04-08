import { describe, it, expect } from "vitest";
import { join } from "path";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { writeReports } from "../src/reportWriter.js";
import type { ReviewRun } from "../src/models.js";

function sampleRun(): ReviewRun {
  return {
    run_id: "test-run-001",
    components_reviewed: ["test.comp"],
    results: {
      "test.comp": {
        component_id: "test.comp",
        status: "issues_found",
        issues: [
          {
            issue_id: 1,
            severity: "high",
            kind: "description_mismatch",
            title: "Mismatch found",
            details: "The description doesn't match the code.",
            evidence: [{ path: "src/main.py", lines: "10-20" }],
            suggested_action: "Update the description.",
          },
        ],
        proposed_invariants: [
          {
            source_component_id: "test.comp",
            target_component_id: "other.comp",
            expectation: "Other should provide Y.",
          },
        ],
        raw_agent_output: "raw output here",
      },
    },
  };
}

describe("writeReports", () => {
  it("creates run directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const runDir = writeReports(sampleRun(), dir);
    expect(existsSync(runDir)).toBe(true);
    expect(runDir.endsWith("test-run-001")).toBe(true);
  });

  it("writes component JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const runDir = writeReports(sampleRun(), dir);
    const jsonPath = join(runDir, "test.comp.json");
    expect(existsSync(jsonPath)).toBe(true);
    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.component_id).toBe("test.comp");
    expect(data.status).toBe("issues_found");
    expect(data.issues).toHaveLength(1);
  });

  it("writes component MD", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const runDir = writeReports(sampleRun(), dir);
    const mdPath = join(runDir, "test.comp.md");
    expect(existsSync(mdPath)).toBe(true);
    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("Mismatch found");
    expect(content).toContain("HIGH");
  });

  it("writes raw output", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const runDir = writeReports(sampleRun(), dir);
    const rawPath = join(runDir, "test.comp.raw.txt");
    expect(existsSync(rawPath)).toBe(true);
    expect(readFileSync(rawPath, "utf-8")).toContain("raw output here");
  });

  it("writes summary JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const runDir = writeReports(sampleRun(), dir);
    const summaryPath = join(runDir, "summary.json");
    expect(existsSync(summaryPath)).toBe(true);
    const data = JSON.parse(readFileSync(summaryPath, "utf-8"));
    expect(data.run_id).toBe("test-run-001");
    expect(data.results["test.comp"]).toBeDefined();
  });

  it("writes summary MD", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const runDir = writeReports(sampleRun(), dir);
    const summaryPath = join(runDir, "summary.md");
    expect(existsSync(summaryPath)).toBe(true);
    const content = readFileSync(summaryPath, "utf-8");
    expect(content).toContain("test.comp");
    expect(content).toContain("issues_found");
  });
});

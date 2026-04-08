import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";
import { writeFileSync } from "fs";
import { FakeAdapter } from "../src/agentAdapter.js";
import { buildGraph } from "../src/graph.js";
import {
  ReviewScheduler,
  buildReviewPrompt,
  computeComponentFingerprint,
  getChangedFiles,
  resolveAffectedComponents,
  runSingleReview,
} from "../src/reviewEngine.js";
import { createTwoComponentRepo } from "./helpers.js";

describe("buildReviewPrompt", () => {
  it("contains component info", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const comp = graph.components["app.main"];
    const prompt = buildReviewPrompt(comp, ["src/main.py"], dir);
    expect(prompt).toContain("app.main");
    expect(prompt).toContain("Main App");
    expect(prompt).toContain("dep.uses_shared");
  });

  it("contains file contents", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const comp = graph.components["app.main"];
    const prompt = buildReviewPrompt(comp, ["src/main.py"], dir);
    expect(prompt).toContain("print('hello')");
  });

  it("contains JSON schema", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const comp = graph.components["app.main"];
    const prompt = buildReviewPrompt(comp, [], dir);
    expect(prompt).toContain('"status"');
    expect(prompt).toContain('"issues"');
  });
});

describe("FakeAdapter", () => {
  it("returns ok by default", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const comp = graph.components["app.main"];
    const adapter = new FakeAdapter();
    const result = runSingleReview(comp, graph, dir, adapter);
    expect(result.component_id).toBe("app.main");
  });

  it("returns custom response", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const comp = graph.components["app.main"];
    const adapter = new FakeAdapter({
      "app.main": {
        component_id: "app.main",
        status: "issues_found",
        issues: [
          {
            issue_id: 1,
            severity: "high",
            kind: "description_mismatch",
            title: "Test issue",
            details: "Something is wrong.",
            evidence: [{ path: "src/main.py", lines: "1" }],
            suggested_action: "Fix it.",
          },
        ],
        proposed_invariants: [],
      },
    });
    const result = runSingleReview(comp, graph, dir, adapter);
    expect(result.status).toBe("issues_found");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].title).toBe("Test issue");
  });
});

describe("ReviewScheduler", () => {
  it("basic queue", () => {
    const sched = new ReviewScheduler();
    expect(sched.enqueue({ component_id: "a", reason: "test", fingerprint: "fp1" })).toBe(true);
    const task = sched.next();
    expect(task).not.toBeNull();
    expect(task!.component_id).toBe("a");
  });

  it("deduplicates by fingerprint", () => {
    const sched = new ReviewScheduler();
    expect(sched.enqueue({ component_id: "a", reason: "t1", fingerprint: "fp1" })).toBe(true);
    expect(sched.enqueue({ component_id: "a", reason: "t2", fingerprint: "fp1" })).toBe(false);
  });

  it("allows requeue with different fingerprint", () => {
    const sched = new ReviewScheduler();
    expect(sched.enqueue({ component_id: "a", reason: "t1", fingerprint: "fp1" })).toBe(true);
    expect(sched.requeue("a", "changed", "fp2")).toBe(true);
  });

  it("returns null when empty", () => {
    const sched = new ReviewScheduler();
    expect(sched.next()).toBeNull();
  });
});

describe("fingerprint", () => {
  it("same state same fingerprint", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const comp = graph.components["app.main"];
    const fp1 = computeComponentFingerprint(comp, dir);
    const fp2 = computeComponentFingerprint(comp, dir);
    expect(fp1).toBe(fp2);
  });

  it("different after file change", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const comp = graph.components["app.main"];
    const fp1 = computeComponentFingerprint(comp, dir);
    writeFileSync(join(dir, "src", "main.py"), "print('changed')");
    const fp2 = computeComponentFingerprint(comp, dir);
    expect(fp1).not.toBe(fp2);
  });
});

describe("getChangedFiles", () => {
  it("detects unstaged changes", () => {
    const dir = createTwoComponentRepo();
    writeFileSync(join(dir, "src", "main.py"), "modified");
    const changed = getChangedFiles(dir);
    expect(changed).toContain("src/main.py");
  });

  it("detects staged changes", () => {
    const dir = createTwoComponentRepo();
    writeFileSync(join(dir, "src", "main.py"), "modified");
    execSync("git add src/main.py", { cwd: dir });
    const changed = getChangedFiles(dir);
    expect(changed).toContain("src/main.py");
  });

  it("detects untracked files", () => {
    const dir = createTwoComponentRepo();
    writeFileSync(join(dir, "new_file.py"), "new");
    const changed = getChangedFiles(dir);
    expect(changed).toContain("new_file.py");
  });

  it("returns empty for clean repo", () => {
    const dir = createTwoComponentRepo();
    expect(getChangedFiles(dir)).toEqual([]);
  });
});

describe("resolveAffectedComponents", () => {
  it("detects scoped file change", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const affected = resolveAffectedComponents(["src/main.py"], graph, dir, dir);
    expect(affected.has("app.main")).toBe(true);
  });

  it("detects component file change", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const affected = resolveAffectedComponents(
      ["app.main.component.md"],
      graph,
      dir,
      dir,
    );
    expect(affected.has("app.main")).toBe(true);
  });

  it("ignores unrelated files", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const affected = resolveAffectedComponents(
      ["unrelated.txt"],
      graph,
      dir,
      dir,
    );
    expect(affected.size).toBe(0);
  });
});

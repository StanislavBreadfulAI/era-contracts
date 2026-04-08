import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { join } from "path";
import { writeFileSync } from "fs";
import { buildGraph } from "../src/graph.js";
import { validateGraph } from "../src/validator.js";
import { createTmpGitRepo, createTwoComponentRepo } from "./helpers.js";

describe("validateGraph", () => {
  it("validates correctly mirrored components", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const issues = validateGraph(graph, dir);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("detects missing mirror on target", () => {
    const dir = createTmpGitRepo();
    writeFileSync(
      join(dir, "a.component.md"),
      `---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: b
    target_path: ./b.component.md
    expectation: B does X.
---

# A

## Description
Component A.
`,
    );
    writeFileSync(
      join(dir, "b.component.md"),
      `---
schema_version: 1
component_id: b
title: B
---

# B

## Description
Component B.
`,
    );
    execSync("git add -A && git commit -q -m add", { cwd: dir });

    const graph = buildGraph(dir);
    const issues = validateGraph(graph, dir);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("Missing mirrored contract"))).toBe(true);
  });

  it("detects expectation mismatch", () => {
    const dir = createTmpGitRepo();
    writeFileSync(
      join(dir, "a.component.md"),
      `---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: b
    target_path: ./b.component.md
    expectation: B does X.
---

# A

## Description
A.
`,
    );
    writeFileSync(
      join(dir, "b.component.md"),
      `---
schema_version: 1
component_id: b
title: B
dependants:
  - contract_id: dep.x
    source_component_id: a
    source_path: ./a.component.md
    expectation: B does Y.
---

# B

## Description
B.
`,
    );
    execSync("git add -A && git commit -q -m add", { cwd: dir });

    const graph = buildGraph(dir);
    const issues = validateGraph(graph, dir);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("expectation mismatch"))).toBe(true);
  });

  it("detects broken dependency link", () => {
    const dir = createTmpGitRepo();
    writeFileSync(
      join(dir, "a.component.md"),
      `---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: nonexistent
    target_path: ./nonexistent.component.md
    expectation: Nonexistent does X.
---

# A

## Description
A.
`,
    );
    execSync("git add -A && git commit -q -m add", { cwd: dir });

    const graph = buildGraph(dir);
    const issues = validateGraph(graph, dir);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("does not exist"))).toBe(true);
  });

  it("detects wrong source in mirror", () => {
    const dir = createTmpGitRepo();
    writeFileSync(
      join(dir, "a.component.md"),
      `---
schema_version: 1
component_id: a
title: A
dependencies:
  - contract_id: dep.x
    target_component_id: b
    target_path: ./b.component.md
    expectation: B does X.
---

# A

## Description
A.
`,
    );
    writeFileSync(
      join(dir, "b.component.md"),
      `---
schema_version: 1
component_id: b
title: B
dependants:
  - contract_id: dep.x
    source_component_id: wrong_source
    source_path: ./wrong.component.md
    expectation: B does X.
---

# B

## Description
B.
`,
    );
    execSync("git add -A && git commit -q -m add", { cwd: dir });

    const graph = buildGraph(dir);
    const issues = validateGraph(graph, dir);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes("points to source"))).toBe(true);
  });

  it("warns about zero-scope components", () => {
    const dir = createTmpGitRepo();
    writeFileSync(
      join(dir, "empty.component.md"),
      `---
schema_version: 1
component_id: empty
title: Empty
scope:
  include:
    - "nonexistent_dir/**"
---

# Empty

## Description
No files.
`,
    );
    execSync("git add -A && git commit -q -m add", { cwd: dir });

    const graph = buildGraph(dir);
    const issues = validateGraph(graph, dir);
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(warnings.some((w) => w.message.includes("zero files"))).toBe(true);
  });

  it("warns about unreferenced components", () => {
    const dir = createTmpGitRepo();
    writeFileSync(
      join(dir, "lonely.component.md"),
      `---
schema_version: 1
component_id: lonely
title: Lonely
---

# Lonely

## Description
All alone.
`,
    );
    execSync("git add -A && git commit -q -m add", { cwd: dir });

    const graph = buildGraph(dir);
    const issues = validateGraph(graph, dir);
    const warnings = issues.filter((i) => i.severity === "warning");
    expect(warnings.some((w) => w.message.includes("not referenced"))).toBe(true);
  });
});

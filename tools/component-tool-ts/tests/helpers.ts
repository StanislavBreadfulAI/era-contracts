/**
 * Shared test helpers.
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export function createTmpGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ct-test-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });

  // Create source files
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "main.py"), "print('hello')");
  writeFileSync(join(dir, "src", "utils.py"), "def helper(): pass");
  writeFileSync(join(dir, "src", "main_test.py"), "def test_main(): pass");
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "shared.py"), "SHARED = True");

  // Gitignore
  writeFileSync(join(dir, ".gitignore"), "*.pyc\n__pycache__/\nbuild/\n");
  mkdirSync(join(dir, "build"), { recursive: true });
  writeFileSync(join(dir, "build", "output.pyc"), "compiled");

  execSync("git add -A", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });

  return dir;
}

export const SAMPLE_COMPONENT_A = `---
schema_version: 1
component_id: app.main
title: Main App
scope:
  include:
    - "src/**"
  exclude:
    - "**/*_test.py"
dependencies:
  - contract_id: dep.uses_shared
    target_component_id: lib.shared
    target_path: ./lib.shared.component.md
    expectation: Shared library provides the SHARED constant.
---

# Main App

## Description
The main application entry point.

## Scope
<!-- component-tool:generated:start -->
- include: \`src/**\`
- exclude: \`**/*_test.py\`
<!-- component-tool:generated:end -->

## Dependencies
<!-- component-tool:generated:start -->
- \`dep.uses_shared\` [lib.shared](./lib.shared.component.md) — Shared library provides the SHARED constant.
<!-- component-tool:generated:end -->

## Dependants
<!-- component-tool:generated:start -->
- (none)
<!-- component-tool:generated:end -->
`;

export const SAMPLE_COMPONENT_B = `---
schema_version: 1
component_id: lib.shared
title: Shared Library
scope:
  include:
    - "lib/**"
dependants:
  - contract_id: dep.uses_shared
    source_component_id: app.main
    source_path: ./app.main.component.md
    expectation: Shared library provides the SHARED constant.
---

# Shared Library

## Description
Provides shared utilities and constants.

## Scope
<!-- component-tool:generated:start -->
- include: \`lib/**\`
<!-- component-tool:generated:end -->

## Dependencies
<!-- component-tool:generated:start -->
- (none)
<!-- component-tool:generated:end -->

## Dependants
<!-- component-tool:generated:start -->
- \`dep.uses_shared\` [app.main](./app.main.component.md) — Shared library provides the SHARED constant.
<!-- component-tool:generated:end -->
`;

export function createTwoComponentRepo(): string {
  const dir = createTmpGitRepo();
  writeFileSync(join(dir, "app.main.component.md"), SAMPLE_COMPONENT_A);
  writeFileSync(join(dir, "lib.shared.component.md"), SAMPLE_COMPONENT_B);
  execSync("git add -A", { cwd: dir });
  execSync('git commit -q -m "add components"', { cwd: dir });
  return dir;
}

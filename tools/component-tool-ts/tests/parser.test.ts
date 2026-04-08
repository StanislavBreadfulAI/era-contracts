import { describe, it, expect } from "vitest";
import { join } from "path";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import {
  parseFrontmatter,
  parseComponentFile,
  renderComponentFile,
  generateScopeSection,
  generateDependenciesSection,
  generateDependantsSection,
} from "../src/parser.js";
import type { ComponentFrontmatter, DependencyEntry, ScopeSpec } from "../src/models.js";

describe("parseFrontmatter", () => {
  it("parses basic frontmatter", () => {
    const content = `---
schema_version: 1
component_id: test.comp
title: Test Component
---

# Test Component
`;
    const { data, body } = parseFrontmatter(content);
    expect(data.component_id).toBe("test.comp");
    expect(data.title).toBe("Test Component");
    expect(body).toContain("# Test Component");
  });

  it("throws on missing frontmatter", () => {
    expect(() => parseFrontmatter("# No frontmatter")).toThrow(
      "No YAML frontmatter",
    );
  });

  it("parses scope", () => {
    const content = `---
schema_version: 1
component_id: my.comp
title: My Component
scope:
  include:
    - "src/**"
  exclude:
    - "**/*_test.py"
---

body
`;
    const { data } = parseFrontmatter(content);
    expect((data.scope as Record<string, string[]>).include).toEqual(["src/**"]);
    expect((data.scope as Record<string, string[]>).exclude).toEqual(["**/*_test.py"]);
  });
});

describe("parseComponentFile", () => {
  it("parses a full file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const filePath = join(dir, "test.component.md");
    writeFileSync(
      filePath,
      `---
schema_version: 1
component_id: test.full
title: Full Test
scope:
  include:
    - "src/**"
dependencies:
  - contract_id: dep.abc
    target_component_id: other
    target_path: ./other.component.md
    expectation: Other provides X.
dependants:
  - contract_id: dep.def
    source_component_id: caller
    source_path: ./caller.component.md
    expectation: This provides Y.
---

# Full Test

## Description
This is a description.

## Scope
<!-- component-tool:generated:start -->
- include: \`src/**\`
<!-- component-tool:generated:end -->
`,
    );

    const { frontmatter: fm, description } = parseComponentFile(filePath);
    expect(fm.component_id).toBe("test.full");
    expect(fm.title).toBe("Full Test");
    expect(fm.scope.include).toEqual(["src/**"]);
    expect(fm.dependencies).toHaveLength(1);
    expect(fm.dependencies[0].contract_id).toBe("dep.abc");
    expect(fm.dependants).toHaveLength(1);
    expect(fm.dependants[0].contract_id).toBe("dep.def");
    expect(description).toContain("This is a description");
  });
});

describe("renderComponentFile round-trip", () => {
  it("round-trips correctly", () => {
    const fm: ComponentFrontmatter = {
      schema_version: 1,
      component_id: "round.trip",
      title: "Round Trip",
      scope: { include: ["src/**"], exclude: ["**/*_test.py"] },
      dependencies: [
        {
          contract_id: "dep.rt1",
          target_component_id: "target",
          target_path: "./target.component.md",
          expectation: "Target does things.",
        },
      ],
      dependants: [
        {
          contract_id: "dep.rt2",
          source_component_id: "caller",
          source_path: "./caller.component.md",
          expectation: "We provide things.",
        },
      ],
    };
    const content = renderComponentFile(fm, "A round-trip test component.");

    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const filePath = join(dir, "round.trip.component.md");
    writeFileSync(filePath, content);

    const { frontmatter: fm2, description } = parseComponentFile(filePath);
    expect(fm2.component_id).toBe("round.trip");
    expect(fm2.scope.include).toEqual(["src/**"]);
    expect(fm2.dependencies).toHaveLength(1);
    expect(fm2.dependants).toHaveLength(1);
    expect(description).toContain("round-trip test");
  });
});

describe("generateSections", () => {
  it("generates scope section", () => {
    const result = generateScopeSection({
      include: ["src/**", "lib/**"],
      exclude: ["**/*.pyc"],
    });
    expect(result).toContain("- include: `src/**`");
    expect(result).toContain("- include: `lib/**`");
    expect(result).toContain("- exclude: `**/*.pyc`");
  });

  it("handles empty scope", () => {
    const result = generateScopeSection({ include: [], exclude: [] });
    expect(result).toContain("(no scope defined)");
  });

  it("generates dependencies section", () => {
    const deps: DependencyEntry[] = [
      {
        contract_id: "dep.x",
        target_component_id: "target",
        target_path: "./target.component.md",
        expectation: "Does X.",
      },
    ];
    const result = generateDependenciesSection(deps);
    expect(result).toContain("`dep.x`");
    expect(result).toContain("[target]");
  });

  it("handles empty dependencies", () => {
    expect(generateDependenciesSection([])).toContain("(none)");
  });

  it("generates dependants section", () => {
    const deps: DependencyEntry[] = [
      {
        contract_id: "dep.y",
        source_component_id: "caller",
        source_path: "./caller.component.md",
        expectation: "Provides Y.",
      },
    ];
    const result = generateDependantsSection(deps);
    expect(result).toContain("`dep.y`");
    expect(result).toContain("[caller]");
  });
});

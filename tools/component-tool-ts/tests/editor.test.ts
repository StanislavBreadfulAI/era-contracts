import { describe, it, expect } from "vitest";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { createComponentFile, addDependency } from "../src/editor.js";
import { parseComponentFile } from "../src/parser.js";

describe("createComponentFile", () => {
  it("creates a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const filePath = join(dir, "test.component.md");
    createComponentFile({
      filePath,
      componentId: "test.comp",
      title: "Test Component",
      scopeInclude: ["src/**"],
      scopeExclude: ["**/*_test.py"],
      description: "A test component.",
    });
    const { frontmatter: fm, description } = parseComponentFile(filePath);
    expect(fm.component_id).toBe("test.comp");
    expect(fm.title).toBe("Test Component");
    expect(fm.scope.include).toEqual(["src/**"]);
    expect(fm.scope.exclude).toEqual(["**/*_test.py"]);
    expect(description.toLowerCase()).toContain("test component");
  });

  it("refuses overwrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const filePath = join(dir, "test.component.md");
    createComponentFile({ filePath, componentId: "a", title: "A" });
    expect(() =>
      createComponentFile({ filePath, componentId: "b", title: "B" }),
    ).toThrow("already exists");
  });

  it("allows force overwrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const filePath = join(dir, "test.component.md");
    createComponentFile({ filePath, componentId: "a", title: "A" });
    createComponentFile({
      filePath,
      componentId: "b",
      title: "B",
      force: true,
    });
    const { frontmatter: fm } = parseComponentFile(filePath);
    expect(fm.component_id).toBe("b");
  });

  it("creates parent dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const filePath = join(dir, "deep", "nested", "test.component.md");
    createComponentFile({ filePath, componentId: "deep", title: "Deep" });
    const { frontmatter: fm } = parseComponentFile(filePath);
    expect(fm.component_id).toBe("deep");
  });
});

describe("addDependency", () => {
  it("adds mirrored dependency", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const source = join(dir, "source.component.md");
    const target = join(dir, "target.component.md");
    createComponentFile({ filePath: source, componentId: "source", title: "Source" });
    createComponentFile({ filePath: target, componentId: "target", title: "Target" });

    const contractId = addDependency({
      sourceFile: source,
      targetFile: target,
      expectation: "Target provides X.",
    });

    const { frontmatter: sourceFm } = parseComponentFile(source);
    expect(sourceFm.dependencies).toHaveLength(1);
    expect(sourceFm.dependencies[0].contract_id).toBe(contractId);
    expect(sourceFm.dependencies[0].target_component_id).toBe("target");

    const { frontmatter: targetFm } = parseComponentFile(target);
    expect(targetFm.dependants).toHaveLength(1);
    expect(targetFm.dependants[0].contract_id).toBe(contractId);
    expect(targetFm.dependants[0].source_component_id).toBe("source");
  });

  it("uses explicit contract_id", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const source = join(dir, "source.component.md");
    const target = join(dir, "target.component.md");
    createComponentFile({ filePath: source, componentId: "source", title: "Source" });
    createComponentFile({ filePath: target, componentId: "target", title: "Target" });

    const id = addDependency({
      sourceFile: source,
      targetFile: target,
      expectation: "X.",
      contractId: "dep.custom",
    });
    expect(id).toBe("dep.custom");
  });

  it("rejects duplicate contract_id", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const source = join(dir, "source.component.md");
    const target = join(dir, "target.component.md");
    createComponentFile({ filePath: source, componentId: "source", title: "Source" });
    createComponentFile({ filePath: target, componentId: "target", title: "Target" });

    addDependency({
      sourceFile: source,
      targetFile: target,
      expectation: "First.",
      contractId: "dep.dup",
    });
    expect(() =>
      addDependency({
        sourceFile: source,
        targetFile: target,
        expectation: "Second.",
        contractId: "dep.dup",
      }),
    ).toThrow("already exists");
  });

  it("supports multiple dependencies", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const source = join(dir, "source.component.md");
    const target = join(dir, "target.component.md");
    createComponentFile({ filePath: source, componentId: "source", title: "Source" });
    createComponentFile({ filePath: target, componentId: "target", title: "Target" });

    addDependency({ sourceFile: source, targetFile: target, expectation: "First." });
    addDependency({ sourceFile: source, targetFile: target, expectation: "Second." });

    const { frontmatter: sourceFm } = parseComponentFile(source);
    expect(sourceFm.dependencies).toHaveLength(2);

    const { frontmatter: targetFm } = parseComponentFile(target);
    expect(targetFm.dependants).toHaveLength(2);
  });

  it("preserves description", () => {
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    const source = join(dir, "source.component.md");
    const target = join(dir, "target.component.md");
    createComponentFile({
      filePath: source,
      componentId: "source",
      title: "Source",
      description: "My custom description.",
    });
    createComponentFile({
      filePath: target,
      componentId: "target",
      title: "Target",
      description: "Target description.",
    });

    addDependency({ sourceFile: source, targetFile: target, expectation: "X." });

    const { description: sourceDesc } = parseComponentFile(source);
    expect(sourceDesc).toContain("My custom description");

    const { description: targetDesc } = parseComponentFile(target);
    expect(targetDesc).toContain("Target description");
  });
});

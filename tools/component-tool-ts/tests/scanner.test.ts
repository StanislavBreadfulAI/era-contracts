import { describe, it, expect } from "vitest";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import {
  findGitRoot,
  isGitignored,
  scanComponentFiles,
  resolveComponentPath,
} from "../src/scanner.js";
import { createTmpGitRepo, createTwoComponentRepo } from "./helpers.js";

describe("findGitRoot", () => {
  it("finds root from repo dir", () => {
    const dir = createTmpGitRepo();
    const root = findGitRoot(dir);
    expect(root).toBe(dir);
  });

  it("finds root from subdir", () => {
    const dir = createTmpGitRepo();
    const root = findGitRoot(join(dir, "src"));
    expect(root).toBe(dir);
  });

  it("returns null for non-repo", () => {
    const { mkdtempSync } = require("fs");
    const { tmpdir } = require("os");
    const dir = mkdtempSync(join(tmpdir(), "ct-"));
    expect(findGitRoot(dir)).toBeNull();
  });
});

describe("isGitignored", () => {
  it("tracked file is not ignored", () => {
    const dir = createTmpGitRepo();
    expect(isGitignored(join(dir, "src", "main.py"), dir)).toBe(false);
  });

  it("gitignored file is detected", () => {
    const dir = createTmpGitRepo();
    const pycFile = join(dir, "something.pyc");
    writeFileSync(pycFile, "compiled");
    expect(isGitignored(pycFile, dir)).toBe(true);
  });
});

describe("scanComponentFiles", () => {
  it("finds component files", () => {
    const dir = createTwoComponentRepo();
    const files = scanComponentFiles(dir);
    const names = files.map((f) => f.split("/").pop());
    expect(names).toContain("app.main.component.md");
    expect(names).toContain("lib.shared.component.md");
  });

  it("excludes gitignored files", () => {
    const dir = createTmpGitRepo();
    const buildDir = join(dir, "build");
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(
      join(buildDir, "ignored.component.md"),
      `---\nschema_version: 1\ncomponent_id: ignored\ntitle: Ignored\n---\n`,
    );
    const files = scanComponentFiles(dir);
    const names = files.map((f) => f.split("/").pop());
    expect(names).not.toContain("ignored.component.md");
  });

  it("returns empty for repo with no components", () => {
    const dir = createTmpGitRepo();
    expect(scanComponentFiles(dir)).toEqual([]);
  });
});

describe("resolveComponentPath", () => {
  it("resolves sibling file", () => {
    const dir = createTwoComponentRepo();
    const fromFile = join(dir, "app.main.component.md");
    const result = resolveComponentPath(
      "./lib.shared.component.md",
      fromFile,
      dir,
    );
    expect(result).not.toBeNull();
    expect(result!.endsWith("lib.shared.component.md")).toBe(true);
  });

  it("rejects outside root", () => {
    const dir = createTwoComponentRepo();
    const fromFile = join(dir, "app.main.component.md");
    const result = resolveComponentPath("../../etc/passwd", fromFile, dir);
    expect(result).toBeNull();
  });

  it("returns null for missing file", () => {
    const dir = createTwoComponentRepo();
    const fromFile = join(dir, "app.main.component.md");
    const result = resolveComponentPath(
      "./nonexistent.component.md",
      fromFile,
      dir,
    );
    expect(result).toBeNull();
  });
});

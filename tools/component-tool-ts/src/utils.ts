/**
 * Utility functions.
 */

import { execSync } from "child_process";
import { readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { minimatch } from "minimatch";

/**
 * Simple recursive glob implementation that returns paths relative to the root.
 */
export function glob(pattern: string, root: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(root, fullPath);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (minimatch(relPath, pattern)) {
          results.push(relPath);
        }
      }
    }
  }

  walk(root);
  return results.sort();
}

/**
 * List all tracked files in the git repo.
 */
export function listTrackedFiles(gitRoot: string): string[] {
  try {
    const result = execSync("git ls-files", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * List all untracked non-ignored files.
 */
export function listUntrackedFiles(gitRoot: string): string[] {
  try {
    const result = execSync("git ls-files --others --exclude-standard", {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * List all non-ignored files under root, relative to root.
 */
export function listAllNonIgnoredFiles(
  root: string,
  gitRoot: string | null,
): string[] {
  if (gitRoot) {
    const tracked = listTrackedFiles(gitRoot);
    const untracked = listUntrackedFiles(gitRoot);
    const allFiles = [...tracked, ...untracked];

    const rootResolved = resolve(root);
    const gitRootResolved = resolve(gitRoot);
    const resultSet = new Set<string>();

    for (const f of allFiles) {
      const absPath = join(gitRootResolved, f);
      const rel = relative(rootResolved, absPath);
      if (!rel.startsWith("..")) {
        resultSet.add(rel);
      }
    }
    return [...resultSet].sort();
  }

  // No git - walk the tree
  const results: string[] = [];
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(relative(root, fullPath));
      }
    }
  }
  walk(root);
  return results.sort();
}

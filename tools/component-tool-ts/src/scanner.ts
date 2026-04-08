/**
 * Component file scanner - finds .component.md files under the workspace root.
 */

import { execSync } from "child_process";
import { existsSync, lstatSync, realpathSync } from "fs";
import { resolve, relative } from "path";
import { glob } from "./utils.js";

export function findGitRoot(start: string): string | null {
  try {
    const result = execSync("git rev-parse --show-toplevel", {
      cwd: start,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

export function isGitignored(filePath: string, gitRoot: string): boolean {
  try {
    execSync(`git check-ignore -q ${JSON.stringify(filePath)}`, {
      cwd: gitRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function scanComponentFiles(
  componentsRoot: string,
  gitRoot: string | null = null,
): string[] {
  if (gitRoot === null) {
    gitRoot = findGitRoot(componentsRoot);
  }

  const resolvedRoot = realpathSync(componentsRoot);
  const pattern = "**/*.component.md";
  const matches = glob(pattern, componentsRoot);

  const result: string[] = [];
  for (const match of matches) {
    const absPath = resolve(componentsRoot, match);

    // Check it's a file
    if (!existsSync(absPath) || !lstatSync(absPath).isFile()) continue;

    // Check for symlink escapes
    try {
      const realPath = realpathSync(absPath);
      const rel = relative(resolvedRoot, realPath);
      if (rel.startsWith("..")) continue;
    } catch {
      continue;
    }

    // Check gitignored
    if (gitRoot && isGitignored(absPath, gitRoot)) continue;

    result.push(absPath);
  }

  return result.sort();
}

export function resolveComponentPath(
  linkPath: string,
  fromFile: string,
  componentsRoot: string,
): string | null {
  const baseDir = resolve(fromFile, "..");
  const resolved = resolve(baseDir, linkPath);
  const resolvedRoot = realpathSync(componentsRoot);

  // Check within root
  const rel = relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || resolve(resolvedRoot, rel) !== resolved) {
    return null;
  }

  if (!existsSync(resolved) || !lstatSync(resolved).isFile()) {
    return null;
  }

  return resolved;
}

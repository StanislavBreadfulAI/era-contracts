/**
 * Utility functions.
 */
/**
 * Simple recursive glob implementation that returns paths relative to the root.
 */
export declare function glob(pattern: string, root: string): string[];
/**
 * List all tracked files in the git repo.
 */
export declare function listTrackedFiles(gitRoot: string): string[];
/**
 * List all untracked non-ignored files.
 */
export declare function listUntrackedFiles(gitRoot: string): string[];
/**
 * List all non-ignored files under root, relative to root.
 */
export declare function listAllNonIgnoredFiles(root: string, gitRoot: string | null): string[];

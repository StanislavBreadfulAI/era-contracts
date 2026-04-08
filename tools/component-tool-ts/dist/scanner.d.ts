/**
 * Component file scanner - finds .component.md files under the workspace root.
 */
export declare function findGitRoot(start: string): string | null;
export declare function isGitignored(filePath: string, gitRoot: string): boolean;
export declare function scanComponentFiles(componentsRoot: string, gitRoot?: string | null): string[];
export declare function resolveComponentPath(linkPath: string, fromFile: string, componentsRoot: string): string | null;

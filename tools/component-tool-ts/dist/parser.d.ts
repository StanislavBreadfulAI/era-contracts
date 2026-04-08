/**
 * Parser for .component.md files with YAML frontmatter.
 */
import type { ComponentFrontmatter, DependencyEntry, ScopeSpec } from "./models.js";
export declare const GENERATED_START = "<!-- component-tool:generated:start -->";
export declare const GENERATED_END = "<!-- component-tool:generated:end -->";
export declare function parseFrontmatter(content: string): {
    data: Record<string, unknown>;
    body: string;
};
export declare function parseComponentFile(filePath: string): {
    frontmatter: ComponentFrontmatter;
    description: string;
};
export declare function frontmatterToYaml(fm: ComponentFrontmatter): string;
export declare function generateScopeSection(scope: ScopeSpec): string;
export declare function generateDependenciesSection(deps: DependencyEntry[]): string;
export declare function generateDependantsSection(deps: DependencyEntry[]): string;
export declare function renderComponentFile(fm: ComponentFrontmatter, description: string): string;

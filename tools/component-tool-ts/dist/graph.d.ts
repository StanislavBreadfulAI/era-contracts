/**
 * Graph builder - constructs the ComponentGraph from parsed component files.
 */
import type { ComponentGraph, ScopeSpec } from "./models.js";
export declare function resolveScope(scope: ScopeSpec, componentsRoot: string, allFiles?: string[] | null, gitRoot?: string | null): string[];
export declare function buildGraph(componentsRoot: string, gitRoot?: string | null): ComponentGraph;

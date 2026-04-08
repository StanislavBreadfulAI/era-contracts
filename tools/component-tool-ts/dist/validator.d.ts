/**
 * Validator - checks structural invariants on the component graph.
 */
import type { ComponentGraph, ValidationIssue } from "./models.js";
export declare function validateGraph(graph: ComponentGraph, componentsRoot: string, gitRoot?: string | null, allFiles?: string[] | null): ValidationIssue[];

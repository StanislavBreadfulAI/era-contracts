/**
 * Review engine - orchestrates component reviews.
 */
import type { AgentAdapter } from "./agentAdapter.js";
import type { Component, ComponentGraph, ReviewResult, ReviewTask } from "./models.js";
export declare function buildReviewPrompt(component: Component, scopedFiles: string[], componentsRoot: string): string;
export declare class ReviewScheduler {
    pending: ReviewTask[];
    inProgress: ReviewTask | null;
    completed: Record<string, ReviewResult>;
    private seenFingerprints;
    enqueue(task: ReviewTask): boolean;
    next(): ReviewTask | null;
    complete(result: ReviewResult): void;
    requeue(componentId: string, reason: string, fingerprint: string): boolean;
}
export declare function computeComponentFingerprint(component: Component, componentsRoot: string, gitRoot?: string | null): string;
export declare function runSingleReview(component: Component, graph: ComponentGraph, componentsRoot: string, adapter: AgentAdapter, gitRoot?: string | null, timeoutSec?: number): ReviewResult;
export declare function getChangedFiles(gitRoot: string): string[];
export declare function resolveAffectedComponents(changedFiles: string[], graph: ComponentGraph, componentsRoot: string, gitRoot?: string | null): Set<string>;

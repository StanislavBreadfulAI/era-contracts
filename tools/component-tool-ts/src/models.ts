/**
 * Core data models for the component tool.
 */

import { createHash } from "crypto";
import { z } from "zod";

// ─── Zod schemas for validation ─────────────────────────────────────────────

export const ScopeSpecSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
});

export const DependencyEntrySchema = z.object({
  contract_id: z.string(),
  target_component_id: z.string().optional(),
  target_path: z.string().optional(),
  source_component_id: z.string().optional(),
  source_path: z.string().optional(),
  expectation: z.string(),
});

export const ComponentFrontmatterSchema = z.object({
  schema_version: z.number().default(1),
  component_id: z.string(),
  title: z.string().default(""),
  scope: ScopeSpecSchema.default({ include: [], exclude: [] }),
  dependencies: z.array(DependencyEntrySchema).default([]),
  dependants: z.array(DependencyEntrySchema).default([]),
});

// ─── TypeScript interfaces ──────────────────────────────────────────────────

export interface ScopeSpec {
  include: string[];
  exclude: string[];
}

export interface DependencyEntry {
  contract_id: string;
  target_component_id?: string;
  target_path?: string;
  source_component_id?: string;
  source_path?: string;
  expectation: string;
}

export interface ComponentFrontmatter {
  schema_version: number;
  component_id: string;
  title: string;
  scope: ScopeSpec;
  dependencies: DependencyEntry[];
  dependants: DependencyEntry[];
}

export interface DependencyContract {
  contract_id: string;
  source_component_id: string;
  target_component_id: string;
  expectation: string;
  source_file: string;
  target_file: string;
}

export interface Component {
  component_id: string;
  title: string;
  file_path: string;
  description_markdown: string;
  scope: ScopeSpec;
  outgoing_contracts: DependencyContract[];
  incoming_contracts: DependencyContract[];
}

export interface ComponentGraph {
  components: Record<string, Component>;
  contracts: Record<string, DependencyContract>;
  dependants_of: Record<string, string[]>;
  dependencies_of: Record<string, string[]>;
  file_to_components: Record<string, string[]>;
}

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
  file_path?: string;
  component_id?: string;
  contract_id?: string;
}

export type IssueSeverity = "high" | "medium" | "low";

export type IssueKind =
  | "description_mismatch"
  | "obligation_violation"
  | "missing_dependency"
  | "stale_invariant"
  | "scope_problem"
  | "other";

export interface Evidence {
  path: string;
  lines: string;
}

export interface ReviewIssue {
  issue_id: number;
  severity: IssueSeverity;
  kind: IssueKind;
  title: string;
  details: string;
  evidence: Evidence[];
  suggested_action: string;
}

export interface ProposedInvariant {
  source_component_id: string;
  target_component_id: string;
  expectation: string;
}

export type ReviewStatus = "ok" | "issues_found" | "blocked";

export interface ReviewResult {
  component_id: string;
  status: ReviewStatus;
  issues: ReviewIssue[];
  proposed_invariants: ProposedInvariant[];
  raw_agent_output: string;
}

export interface ReviewTask {
  component_id: string;
  reason: string;
  fingerprint: string;
}

export interface ReviewRun {
  run_id: string;
  components_reviewed: string[];
  results: Record<string, ReviewResult>;
}

// ─── Fingerprint computation ────────────────────────────────────────────────

export function computeFingerprint(
  componentFileContent: string,
  scopedFileHashes: Record<string, string>,
  incomingContracts: DependencyContract[],
  outgoingContracts: DependencyContract[],
): string {
  const data = {
    component_file: createHash("sha256")
      .update(componentFileContent)
      .digest("hex"),
    scoped_files: Object.fromEntries(
      Object.entries(scopedFileHashes).sort(([a], [b]) => a.localeCompare(b)),
    ),
    incoming: [...incomingContracts]
      .sort((a, b) => a.contract_id.localeCompare(b.contract_id))
      .map((c) => ({
        contract_id: c.contract_id,
        source_component_id: c.source_component_id,
        target_component_id: c.target_component_id,
        expectation: c.expectation,
      })),
    outgoing: [...outgoingContracts]
      .sort((a, b) => a.contract_id.localeCompare(b.contract_id))
      .map((c) => ({
        contract_id: c.contract_id,
        source_component_id: c.source_component_id,
        target_component_id: c.target_component_id,
        expectation: c.expectation,
      })),
  };
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
}

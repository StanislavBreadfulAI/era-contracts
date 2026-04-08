/**
 * Core data models for the component tool.
 */
import { z } from "zod";
export declare const ScopeSpecSchema: z.ZodObject<{
    include: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    exclude: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    include: string[];
    exclude: string[];
}, {
    include?: string[] | undefined;
    exclude?: string[] | undefined;
}>;
export declare const DependencyEntrySchema: z.ZodObject<{
    contract_id: z.ZodString;
    target_component_id: z.ZodOptional<z.ZodString>;
    target_path: z.ZodOptional<z.ZodString>;
    source_component_id: z.ZodOptional<z.ZodString>;
    source_path: z.ZodOptional<z.ZodString>;
    expectation: z.ZodString;
}, "strip", z.ZodTypeAny, {
    contract_id: string;
    expectation: string;
    target_component_id?: string | undefined;
    target_path?: string | undefined;
    source_component_id?: string | undefined;
    source_path?: string | undefined;
}, {
    contract_id: string;
    expectation: string;
    target_component_id?: string | undefined;
    target_path?: string | undefined;
    source_component_id?: string | undefined;
    source_path?: string | undefined;
}>;
export declare const ComponentFrontmatterSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodNumber>;
    component_id: z.ZodString;
    title: z.ZodDefault<z.ZodString>;
    scope: z.ZodDefault<z.ZodObject<{
        include: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        exclude: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        include: string[];
        exclude: string[];
    }, {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    }>>;
    dependencies: z.ZodDefault<z.ZodArray<z.ZodObject<{
        contract_id: z.ZodString;
        target_component_id: z.ZodOptional<z.ZodString>;
        target_path: z.ZodOptional<z.ZodString>;
        source_component_id: z.ZodOptional<z.ZodString>;
        source_path: z.ZodOptional<z.ZodString>;
        expectation: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }, {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }>, "many">>;
    dependants: z.ZodDefault<z.ZodArray<z.ZodObject<{
        contract_id: z.ZodString;
        target_component_id: z.ZodOptional<z.ZodString>;
        target_path: z.ZodOptional<z.ZodString>;
        source_component_id: z.ZodOptional<z.ZodString>;
        source_path: z.ZodOptional<z.ZodString>;
        expectation: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }, {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    component_id: string;
    schema_version: number;
    title: string;
    scope: {
        include: string[];
        exclude: string[];
    };
    dependencies: {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }[];
    dependants: {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }[];
}, {
    component_id: string;
    schema_version?: number | undefined;
    title?: string | undefined;
    scope?: {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
    } | undefined;
    dependencies?: {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }[] | undefined;
    dependants?: {
        contract_id: string;
        expectation: string;
        target_component_id?: string | undefined;
        target_path?: string | undefined;
        source_component_id?: string | undefined;
        source_path?: string | undefined;
    }[] | undefined;
}>;
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
export type IssueKind = "description_mismatch" | "obligation_violation" | "missing_dependency" | "stale_invariant" | "scope_problem" | "other";
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
export declare function computeFingerprint(componentFileContent: string, scopedFileHashes: Record<string, string>, incomingContracts: DependencyContract[], outgoingContracts: DependencyContract[]): string;

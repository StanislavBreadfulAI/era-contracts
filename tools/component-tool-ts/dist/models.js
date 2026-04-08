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
// ─── Fingerprint computation ────────────────────────────────────────────────
export function computeFingerprint(componentFileContent, scopedFileHashes, incomingContracts, outgoingContracts) {
    const data = {
        component_file: createHash("sha256")
            .update(componentFileContent)
            .digest("hex"),
        scoped_files: Object.fromEntries(Object.entries(scopedFileHashes).sort(([a], [b]) => a.localeCompare(b))),
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
//# sourceMappingURL=models.js.map
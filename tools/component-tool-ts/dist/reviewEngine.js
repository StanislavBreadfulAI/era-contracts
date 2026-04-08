/**
 * Review engine - orchestrates component reviews.
 */
import { createHash } from "crypto";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, relative } from "path";
import { resolveScope } from "./graph.js";
import { computeFingerprint } from "./models.js";
export function buildReviewPrompt(component, scopedFiles, componentsRoot) {
    // Read scoped file contents
    const fileContents = [];
    for (const relPath of scopedFiles) {
        const absPath = resolve(componentsRoot, relPath);
        try {
            let content = readFileSync(absPath, "utf-8");
            if (content.length > 50000) {
                content = content.slice(0, 50000) + "\n... (truncated)";
            }
            fileContents.push(`### File: ${relPath}\n\`\`\`\n${content}\n\`\`\``);
        }
        catch {
            fileContents.push(`### File: ${relPath}\n(could not read)`);
        }
    }
    const assumptions = component.outgoing_contracts.map((c) => `- **${c.contract_id}**: Depends on \`${c.target_component_id}\` — ${c.expectation}`);
    const obligations = component.incoming_contracts.map((c) => `- **${c.contract_id}**: Expected by \`${c.source_component_id}\` — ${c.expectation}`);
    return `You are reviewing the component \`${component.component_id}\` ("${component.title}").

## Component Description
${component.description_markdown}

## Scope
Include patterns: ${component.scope.include.map((p) => `\`${p}\``).join(", ") || "(none)"}
Exclude patterns: ${component.scope.exclude.map((p) => `\`${p}\``).join(", ") || "(none)"}

## Outgoing Dependencies (ASSUMPTIONS — treat these as true)
${assumptions.length > 0 ? assumptions.join("\n") : "(none)"}

## Incoming Obligations (VERIFY — the component must satisfy these)
${obligations.length > 0 ? obligations.join("\n") : "(none)"}

## Important Notes
- Scope overlaps with other components are ALLOWED and should not be flagged.
- If the component has outgoing dependencies, assume those external contracts are fulfilled.
- Focus on whether THIS component meets its own description and satisfies its incoming obligations.
- Number issues starting from 1.
- Separately propose missing invariants/dependencies when appropriate.

## Files in Scope
${fileContents.length > 0 ? fileContents.join("\n\n") : "(no files in scope)"}

## Required Output
Respond with ONLY a JSON object in this exact schema:

\`\`\`json
{
  "component_id": "${component.component_id}",
  "status": "ok | issues_found | blocked",
  "issues": [
    {
      "issue_id": 1,
      "severity": "high | medium | low",
      "kind": "description_mismatch | obligation_violation | missing_dependency | stale_invariant | scope_problem | other",
      "title": "Short title",
      "details": "Long explanation",
      "evidence": [
        {
          "path": "relative/file/path.py",
          "lines": "10-42"
        }
      ],
      "suggested_action": "Suggested fix"
    }
  ],
  "proposed_invariants": [
    {
      "source_component_id": "some.component",
      "target_component_id": "other.component",
      "expectation": "What should be guaranteed"
    }
  ]
}
\`\`\`
`;
}
export class ReviewScheduler {
    pending = [];
    inProgress = null;
    completed = {};
    seenFingerprints = new Map();
    enqueue(task) {
        const existing = this.seenFingerprints.get(task.component_id);
        if (existing === task.fingerprint)
            return false;
        this.seenFingerprints.set(task.component_id, task.fingerprint);
        this.pending.push(task);
        return true;
    }
    next() {
        if (this.pending.length === 0)
            return null;
        this.inProgress = this.pending.shift();
        return this.inProgress;
    }
    complete(result) {
        this.completed[result.component_id] = result;
        this.inProgress = null;
    }
    requeue(componentId, reason, fingerprint) {
        return this.enqueue({ component_id: componentId, reason, fingerprint });
    }
}
export function computeComponentFingerprint(component, componentsRoot, gitRoot = null) {
    const componentContent = readFileSync(component.file_path, "utf-8");
    const scopedFiles = resolveScope(component.scope, componentsRoot, null, gitRoot);
    const fileHashes = {};
    for (const relPath of scopedFiles) {
        const absPath = resolve(componentsRoot, relPath);
        try {
            const content = readFileSync(absPath);
            fileHashes[relPath] = createHash("sha256").update(content).digest("hex");
        }
        catch {
            // skip
        }
    }
    return computeFingerprint(componentContent, fileHashes, component.incoming_contracts, component.outgoing_contracts);
}
export function runSingleReview(component, graph, componentsRoot, adapter, gitRoot = null, timeoutSec = 300) {
    const scopedFiles = resolveScope(component.scope, componentsRoot, null, gitRoot);
    const prompt = buildReviewPrompt(component, scopedFiles, componentsRoot);
    const result = adapter.runReview(prompt, componentsRoot, timeoutSec);
    if (result.parsed_json) {
        try {
            const json = result.parsed_json;
            const issues = (json.issues || []).map((i) => ({
                issue_id: i.issue_id || 0,
                severity: i.severity || "low",
                kind: i.kind || "other",
                title: i.title || "",
                details: i.details || "",
                evidence: (i.evidence || []).map((e) => ({
                    path: e.path || "",
                    lines: e.lines || "",
                })),
                suggested_action: i.suggested_action || "",
            }));
            const proposedInvariants = (json.proposed_invariants || []).map((i) => ({
                source_component_id: i.source_component_id || "",
                target_component_id: i.target_component_id || "",
                expectation: i.expectation || "",
            }));
            return {
                component_id: component.component_id,
                status: json.status || "ok",
                issues,
                proposed_invariants: proposedInvariants,
                raw_agent_output: result.raw_output,
            };
        }
        catch {
            // Fall through to blocked
        }
    }
    return {
        component_id: component.component_id,
        status: "blocked",
        issues: [],
        proposed_invariants: [],
        raw_agent_output: result.raw_output,
    };
}
export function getChangedFiles(gitRoot) {
    const files = new Set();
    try {
        // Staged changes
        const staged = execSync("git diff --name-only --cached", {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        for (const line of staged.trim().split("\n")) {
            if (line)
                files.add(line);
        }
        // Unstaged changes
        const unstaged = execSync("git diff --name-only", {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        for (const line of unstaged.trim().split("\n")) {
            if (line)
                files.add(line);
        }
        // Untracked non-ignored
        const untracked = execSync("git ls-files --others --exclude-standard", {
            cwd: gitRoot,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        });
        for (const line of untracked.trim().split("\n")) {
            if (line)
                files.add(line);
        }
    }
    catch {
        // ignore
    }
    return [...files].sort();
}
export function resolveAffectedComponents(changedFiles, graph, componentsRoot, gitRoot = null) {
    const affected = new Set();
    const rootResolved = resolve(componentsRoot);
    const gitRootResolved = gitRoot ? resolve(gitRoot) : rootResolved;
    for (const changedFile of changedFiles) {
        const absPath = resolve(gitRootResolved, changedFile);
        // Check if it's a component file
        if (changedFile.endsWith(".component.md")) {
            for (const [cid, comp] of Object.entries(graph.components)) {
                if (resolve(comp.file_path) === absPath) {
                    affected.add(cid);
                    break;
                }
            }
        }
        // Check scope match
        let relToRoot;
        try {
            relToRoot = relative(rootResolved, absPath);
            if (relToRoot.startsWith(".."))
                continue;
        }
        catch {
            continue;
        }
        const components = graph.file_to_components[relToRoot];
        if (components) {
            for (const cid of components) {
                affected.add(cid);
            }
        }
    }
    return affected;
}
//# sourceMappingURL=reviewEngine.js.map
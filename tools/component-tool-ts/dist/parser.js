/**
 * Parser for .component.md files with YAML frontmatter.
 */
import { readFileSync } from "fs";
import * as yaml from "js-yaml";
import { ComponentFrontmatterSchema } from "./models.js";
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const DESCRIPTION_RE = /## Description\s*\n([\s\S]*?)(?=\n## |\s*$)/;
export const GENERATED_START = "<!-- component-tool:generated:start -->";
export const GENERATED_END = "<!-- component-tool:generated:end -->";
export function parseFrontmatter(content) {
    const match = content.match(FRONTMATTER_RE);
    if (!match) {
        throw new Error("No YAML frontmatter found in component file");
    }
    const yamlText = match[1];
    const body = content.slice(match[0].length);
    const data = yaml.load(yamlText) || {};
    return { data, body };
}
export function parseComponentFile(filePath) {
    const content = readFileSync(filePath, "utf-8");
    const { data, body } = parseFrontmatter(content);
    const frontmatter = ComponentFrontmatterSchema.parse(data);
    // Extract description
    const descMatch = body.match(DESCRIPTION_RE);
    const description = descMatch ? descMatch[1].trim() : "";
    return { frontmatter, description };
}
export function frontmatterToYaml(fm) {
    const data = {
        schema_version: fm.schema_version,
        component_id: fm.component_id,
        title: fm.title,
    };
    if (fm.scope.include.length > 0 || fm.scope.exclude.length > 0) {
        const scope = {};
        if (fm.scope.include.length > 0)
            scope.include = fm.scope.include;
        if (fm.scope.exclude.length > 0)
            scope.exclude = fm.scope.exclude;
        data.scope = scope;
    }
    if (fm.dependencies.length > 0) {
        data.dependencies = fm.dependencies.map((dep) => {
            const d = { contract_id: dep.contract_id };
            if (dep.target_component_id)
                d.target_component_id = dep.target_component_id;
            if (dep.target_path)
                d.target_path = dep.target_path;
            d.expectation = dep.expectation;
            return d;
        });
    }
    if (fm.dependants.length > 0) {
        data.dependants = fm.dependants.map((dep) => {
            const d = { contract_id: dep.contract_id };
            if (dep.source_component_id)
                d.source_component_id = dep.source_component_id;
            if (dep.source_path)
                d.source_path = dep.source_path;
            d.expectation = dep.expectation;
            return d;
        });
    }
    return yaml.dump(data, { lineWidth: -1, quotingType: "'", forceQuotes: false });
}
export function generateScopeSection(scope) {
    const lines = [];
    for (const p of scope.include)
        lines.push(`- include: \`${p}\``);
    for (const p of scope.exclude)
        lines.push(`- exclude: \`${p}\``);
    return lines.length > 0 ? lines.join("\n") : "- (no scope defined)";
}
export function generateDependenciesSection(deps) {
    if (deps.length === 0)
        return "- (none)";
    return deps
        .map((dep) => {
        const targetId = dep.target_component_id || "unknown";
        const targetPath = dep.target_path || "";
        if (targetPath) {
            return `- \`${dep.contract_id}\` [${targetId}](${targetPath}) \u2014 ${dep.expectation}`;
        }
        return `- \`${dep.contract_id}\` ${targetId} \u2014 ${dep.expectation}`;
    })
        .join("\n");
}
export function generateDependantsSection(deps) {
    if (deps.length === 0)
        return "- (none)";
    return deps
        .map((dep) => {
        const sourceId = dep.source_component_id || "unknown";
        const sourcePath = dep.source_path || "";
        if (sourcePath) {
            return `- \`${dep.contract_id}\` [${sourceId}](${sourcePath}) \u2014 ${dep.expectation}`;
        }
        return `- \`${dep.contract_id}\` ${sourceId} \u2014 ${dep.expectation}`;
    })
        .join("\n");
}
export function renderComponentFile(fm, description) {
    const yamlStr = frontmatterToYaml(fm).trimEnd();
    const scopeBody = generateScopeSection(fm.scope);
    const depsBody = generateDependenciesSection(fm.dependencies);
    const dependantsBody = generateDependantsSection(fm.dependants);
    return `---
${yamlStr}
---

# ${fm.title}

## Description
${description}

## Scope
${GENERATED_START}
${scopeBody}
${GENERATED_END}

## Dependencies
${GENERATED_START}
${depsBody}
${GENERATED_END}

## Dependants
${GENERATED_START}
${dependantsBody}
${GENERATED_END}
`;
}
//# sourceMappingURL=parser.js.map
/**
 * Graph builder - constructs the ComponentGraph from parsed component files.
 */
import { minimatch } from "minimatch";
import { parseComponentFile } from "./parser.js";
import { resolveComponentPath, scanComponentFiles } from "./scanner.js";
import { listAllNonIgnoredFiles } from "./utils.js";
export function resolveScope(scope, componentsRoot, allFiles = null, gitRoot = null) {
    if (allFiles === null) {
        allFiles = listAllNonIgnoredFiles(componentsRoot, gitRoot);
    }
    if (scope.include.length === 0)
        return [];
    const matched = new Set();
    for (const file of allFiles) {
        for (const pattern of scope.include) {
            if (minimatch(file, pattern)) {
                matched.add(file);
                break;
            }
        }
    }
    if (scope.exclude.length > 0) {
        for (const file of [...matched]) {
            for (const pattern of scope.exclude) {
                if (minimatch(file, pattern)) {
                    matched.delete(file);
                    break;
                }
            }
        }
    }
    return [...matched].sort();
}
export function buildGraph(componentsRoot, gitRoot = null) {
    const componentFiles = scanComponentFiles(componentsRoot, gitRoot);
    const allFiles = listAllNonIgnoredFiles(componentsRoot, gitRoot);
    const graph = {
        components: {},
        contracts: {},
        dependants_of: {},
        dependencies_of: {},
        file_to_components: {},
    };
    // First pass: parse all component files
    const parsed = new Map();
    for (const filePath of componentFiles) {
        try {
            const { frontmatter, description } = parseComponentFile(filePath);
            parsed.set(frontmatter.component_id, {
                frontmatter,
                description,
                filePath,
            });
        }
        catch {
            // Skip files without valid YAML frontmatter (e.g. legacy .component.md files)
            continue;
        }
    }
    // Second pass: build components and contracts
    for (const [cid, { frontmatter: fm, description, filePath }] of parsed) {
        const component = {
            component_id: cid,
            title: fm.title,
            file_path: filePath,
            description_markdown: description,
            scope: fm.scope,
            outgoing_contracts: [],
            incoming_contracts: [],
        };
        // Resolve scope
        const scopedFiles = resolveScope(fm.scope, componentsRoot, allFiles, gitRoot);
        for (const sf of scopedFiles) {
            if (!graph.file_to_components[sf]) {
                graph.file_to_components[sf] = [];
            }
            graph.file_to_components[sf].push(cid);
        }
        // Process outgoing dependencies
        for (const dep of fm.dependencies) {
            let targetPath = null;
            if (dep.target_path) {
                targetPath = resolveComponentPath(dep.target_path, filePath, componentsRoot);
            }
            const contract = {
                contract_id: dep.contract_id,
                source_component_id: cid,
                target_component_id: dep.target_component_id || "",
                expectation: dep.expectation,
                source_file: filePath,
                target_file: targetPath || dep.target_path || "",
            };
            component.outgoing_contracts.push(contract);
            graph.contracts[dep.contract_id] = contract;
            if (!graph.dependencies_of[cid])
                graph.dependencies_of[cid] = [];
            if (dep.target_component_id) {
                graph.dependencies_of[cid].push(dep.target_component_id);
            }
        }
        // Process incoming dependants
        for (const dep of fm.dependants) {
            let sourcePath = null;
            if (dep.source_path) {
                sourcePath = resolveComponentPath(dep.source_path, filePath, componentsRoot);
            }
            const contract = {
                contract_id: dep.contract_id,
                source_component_id: dep.source_component_id || "",
                target_component_id: cid,
                expectation: dep.expectation,
                source_file: sourcePath || dep.source_path || "",
                target_file: filePath,
            };
            component.incoming_contracts.push(contract);
            if (!graph.contracts[dep.contract_id]) {
                graph.contracts[dep.contract_id] = contract;
            }
            if (!graph.dependants_of[cid])
                graph.dependants_of[cid] = [];
            if (dep.source_component_id) {
                graph.dependants_of[cid].push(dep.source_component_id);
            }
        }
        graph.components[cid] = component;
    }
    return graph;
}
//# sourceMappingURL=graph.js.map
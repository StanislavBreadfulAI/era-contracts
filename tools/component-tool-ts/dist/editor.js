/**
 * Editor - creates and updates .component.md files.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, relative } from "path";
import { v4 as uuidv4 } from "uuid";
import { parseComponentFile, renderComponentFile } from "./parser.js";
export function generateContractId() {
    return `dep.${uuidv4().replace(/-/g, "").slice(0, 12)}`;
}
export function createComponentFile(options) {
    const { filePath, componentId, title, scopeInclude = [], scopeExclude = [], description = "", force = false, } = options;
    if (existsSync(filePath) && !force) {
        throw new Error(`File already exists: ${filePath}. Use --force to overwrite.`);
    }
    const fm = {
        schema_version: 1,
        component_id: componentId,
        title,
        scope: { include: scopeInclude, exclude: scopeExclude },
        dependencies: [],
        dependants: [],
    };
    const content = renderComponentFile(fm, description || "TODO: Describe this component.");
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, content, "utf-8");
    return filePath;
}
export function addDependency(options) {
    const { sourceFile, targetFile, expectation } = options;
    const contractId = options.contractId || generateContractId();
    // Parse both files
    const { frontmatter: sourceFm, description: sourceDesc } = parseComponentFile(sourceFile);
    const { frontmatter: targetFm, description: targetDesc } = parseComponentFile(targetFile);
    // Check for duplicates
    if (sourceFm.dependencies.some((d) => d.contract_id === contractId)) {
        throw new Error(`Contract '${contractId}' already exists in ${sourceFile}`);
    }
    if (targetFm.dependants.some((d) => d.contract_id === contractId)) {
        throw new Error(`Contract '${contractId}' already exists in ${targetFile}`);
    }
    // Compute relative paths
    const sourceToTarget = relative(dirname(sourceFile), targetFile);
    const targetToSource = relative(dirname(targetFile), sourceFile);
    // Add outgoing dependency to source
    sourceFm.dependencies.push({
        contract_id: contractId,
        target_component_id: targetFm.component_id,
        target_path: sourceToTarget,
        expectation,
    });
    // Add incoming dependant to target
    targetFm.dependants.push({
        contract_id: contractId,
        source_component_id: sourceFm.component_id,
        source_path: targetToSource,
        expectation,
    });
    // Write both files
    writeFileSync(sourceFile, renderComponentFile(sourceFm, sourceDesc), "utf-8");
    writeFileSync(targetFile, renderComponentFile(targetFm, targetDesc), "utf-8");
    return contractId;
}
//# sourceMappingURL=editor.js.map
/**
 * Editor - creates and updates .component.md files.
 */
export declare function generateContractId(): string;
export declare function createComponentFile(options: {
    filePath: string;
    componentId: string;
    title: string;
    scopeInclude?: string[];
    scopeExclude?: string[];
    description?: string;
    force?: boolean;
}): string;
export declare function addDependency(options: {
    sourceFile: string;
    targetFile: string;
    expectation: string;
    contractId?: string;
}): string;

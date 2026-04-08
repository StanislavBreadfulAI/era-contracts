/**
 * Validator - checks structural invariants on the component graph.
 */

import type { ComponentGraph, ValidationIssue } from "./models.js";
import { resolveScope } from "./graph.js";
import { resolveComponentPath } from "./scanner.js";

export function validateGraph(
  graph: ComponentGraph,
  componentsRoot: string,
  gitRoot: string | null = null,
  allFiles: string[] | null = null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check for duplicate contract_ids across components
  const seenContractIds = new Map<string, string>();
  for (const [cid, comp] of Object.entries(graph.components)) {
    for (const contract of comp.outgoing_contracts) {
      const existing = seenContractIds.get(contract.contract_id);
      if (existing && existing !== cid) {
        issues.push({
          severity: "error",
          message: `Duplicate contract_id '${contract.contract_id}' in component '${cid}' (already defined in '${existing}')`,
          component_id: cid,
          contract_id: contract.contract_id,
        });
      } else {
        seenContractIds.set(contract.contract_id, cid);
      }
    }
  }

  // Validate mirrored contracts
  for (const [cid, comp] of Object.entries(graph.components)) {
    // Check each outgoing dependency has a matching incoming on the target
    for (const contract of comp.outgoing_contracts) {
      const targetCid = contract.target_component_id;
      if (!graph.components[targetCid]) {
        issues.push({
          severity: "error",
          message: `Broken dependency link: component '${cid}' depends on '${targetCid}' which does not exist`,
          file_path: comp.file_path,
          component_id: cid,
          contract_id: contract.contract_id,
        });
        continue;
      }

      const targetComp = graph.components[targetCid];
      const mirror = targetComp.incoming_contracts.find(
        (c) => c.contract_id === contract.contract_id,
      );

      if (!mirror) {
        issues.push({
          severity: "error",
          message: `Missing mirrored contract: '${contract.contract_id}' exists as dependency in '${cid}' but not as dependant in '${targetCid}'`,
          component_id: targetCid,
          contract_id: contract.contract_id,
        });
      } else {
        if (mirror.expectation !== contract.expectation) {
          issues.push({
            severity: "error",
            message: `Mirrored contract expectation mismatch for '${contract.contract_id}': source says '${contract.expectation}' but target says '${mirror.expectation}'`,
            contract_id: contract.contract_id,
          });
        }
        if (mirror.source_component_id !== cid) {
          issues.push({
            severity: "error",
            message: `Mirrored contract '${contract.contract_id}' in '${targetCid}' points to source '${mirror.source_component_id}' but should point to '${cid}'`,
            contract_id: contract.contract_id,
          });
        }
      }
    }

    // Check each incoming dependant has a matching outgoing on the source
    for (const contract of comp.incoming_contracts) {
      const sourceCid = contract.source_component_id;
      if (!graph.components[sourceCid]) {
        issues.push({
          severity: "error",
          message: `Broken dependant link: component '${cid}' lists dependant '${sourceCid}' which does not exist`,
          file_path: comp.file_path,
          component_id: cid,
          contract_id: contract.contract_id,
        });
        continue;
      }

      const sourceComp = graph.components[sourceCid];
      const mirror = sourceComp.outgoing_contracts.find(
        (c) => c.contract_id === contract.contract_id,
      );

      if (!mirror) {
        issues.push({
          severity: "error",
          message: `Missing mirrored contract: '${contract.contract_id}' exists as dependant in '${cid}' but not as dependency in '${sourceCid}'`,
          component_id: sourceCid,
          contract_id: contract.contract_id,
        });
      }
    }
  }

  // Warnings: zero-scope components
  for (const [cid, comp] of Object.entries(graph.components)) {
    if (comp.scope.include.length > 0) {
      const scoped = resolveScope(comp.scope, componentsRoot, allFiles, gitRoot);
      if (scoped.length === 0) {
        issues.push({
          severity: "warning",
          message: `Component '${cid}' scope resolves to zero files`,
          component_id: cid,
          file_path: comp.file_path,
        });
      }
    }
  }

  // Warning: dangling unreferenced components
  const referenced = new Set<string>();
  for (const comp of Object.values(graph.components)) {
    for (const c of comp.outgoing_contracts)
      referenced.add(c.target_component_id);
    for (const c of comp.incoming_contracts)
      referenced.add(c.source_component_id);
  }
  for (const [cid, comp] of Object.entries(graph.components)) {
    if (
      !referenced.has(cid) &&
      comp.outgoing_contracts.length === 0 &&
      comp.incoming_contracts.length === 0
    ) {
      issues.push({
        severity: "warning",
        message: `Component '${cid}' is not referenced by any other component`,
        component_id: cid,
      });
    }
  }

  // Warning: cyclic dependencies
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cyclesFound: string[][] = [];

  function detectCycle(node: string, path: string[]): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of graph.dependencies_of[node] || []) {
      if (!visited.has(neighbor)) {
        detectCycle(neighbor, path);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cyclesFound.push([...path.slice(cycleStart), neighbor]);
      }
    }

    path.pop();
    recStack.delete(node);
  }

  for (const cid of Object.keys(graph.components)) {
    if (!visited.has(cid)) {
      detectCycle(cid, []);
    }
  }

  for (const cycle of cyclesFound) {
    issues.push({
      severity: "warning",
      message: `Cyclic dependency detected: ${cycle.join(" -> ")}`,
    });
  }

  return issues;
}

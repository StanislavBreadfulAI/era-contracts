import { describe, it, expect } from "vitest";
import { buildGraph, resolveScope } from "../src/graph.js";
import { createTmpGitRepo, createTwoComponentRepo } from "./helpers.js";

describe("resolveScope", () => {
  it("includes matching files", () => {
    const dir = createTmpGitRepo();
    const files = resolveScope({ include: ["src/**"], exclude: [] }, dir, null, dir);
    expect(files).toContain("src/main.py");
    expect(files).toContain("src/utils.py");
  });

  it("excludes matching patterns", () => {
    const dir = createTmpGitRepo();
    const files = resolveScope(
      { include: ["src/**"], exclude: ["**/*_test.py"] },
      dir,
      null,
      dir,
    );
    expect(files).toContain("src/main.py");
    expect(files).not.toContain("src/main_test.py");
  });

  it("returns empty for empty include", () => {
    const dir = createTmpGitRepo();
    expect(resolveScope({ include: [], exclude: [] }, dir)).toEqual([]);
  });

  it("returns empty for no match", () => {
    const dir = createTmpGitRepo();
    expect(
      resolveScope({ include: ["nonexistent/**"], exclude: [] }, dir, null, dir),
    ).toEqual([]);
  });

  it("supports multiple include patterns", () => {
    const dir = createTmpGitRepo();
    const files = resolveScope(
      { include: ["src/**", "lib/**"], exclude: [] },
      dir,
      null,
      dir,
    );
    expect(files).toContain("src/main.py");
    expect(files).toContain("lib/shared.py");
  });
});

describe("buildGraph", () => {
  it("builds from two components", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    expect(graph.components["app.main"]).toBeDefined();
    expect(graph.components["lib.shared"]).toBeDefined();
  });

  it("populates contracts", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    expect(graph.contracts["dep.uses_shared"]).toBeDefined();
  });

  it("sets outgoing contracts", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const main = graph.components["app.main"];
    expect(main.outgoing_contracts).toHaveLength(1);
    expect(main.outgoing_contracts[0].target_component_id).toBe("lib.shared");
  });

  it("sets incoming contracts", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    const shared = graph.components["lib.shared"];
    expect(shared.incoming_contracts).toHaveLength(1);
    expect(shared.incoming_contracts[0].source_component_id).toBe("app.main");
  });

  it("builds dependency index", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    expect(graph.dependencies_of["app.main"]).toContain("lib.shared");
  });

  it("builds dependant index", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    expect(graph.dependants_of["lib.shared"]).toContain("app.main");
  });

  it("builds file-to-components index", () => {
    const dir = createTwoComponentRepo();
    const graph = buildGraph(dir);
    expect(graph.file_to_components["src/main.py"]).toContain("app.main");
    expect(graph.file_to_components["lib/shared.py"]).toContain("lib.shared");
  });

  it("handles empty repo", () => {
    const dir = createTmpGitRepo();
    const graph = buildGraph(dir);
    expect(Object.keys(graph.components)).toHaveLength(0);
  });
});

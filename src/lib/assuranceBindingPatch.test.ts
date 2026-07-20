import { describe, expect, it } from "vitest";
import {
  applyBindingGraphPatch,
  assertBindingGraphPatchBase,
  type BindingGraphPatch,
} from "./assuranceBindingPatch";
import type { SimEdge, SimNode } from "@/types/simulator";

const nodes: SimNode[] = [
  {
    id: "executor",
    type: "executor",
    config: { label: "Executor", model: "legacy-model" },
    position: { x: 10, y: 20 },
  },
  {
    id: "output",
    type: "output",
    config: { label: "Output" },
    position: { x: 30, y: 20 },
  },
];
const edges: SimEdge[] = [{ id: "edge", source: "executor", target: "output" }];

const patch: BindingGraphPatch = {
  schema_version: "assurance.graph_patch.v1",
  patch_id: "patch-1",
  base_source_graph_hash: "a".repeat(64),
  node_operations: [
    {
      op: "bind_operation",
      node_id: "executor",
      expected_node_type: "executor",
      operation_id: "analyze",
      operation_version: "1.0.0",
      replacement_config: {
        label: "Executor",
        assuranceOperationId: "analyze",
        assuranceOperationVersion: "1.0.0",
      },
    },
  ],
  edge_operations: [
    {
      op: "set_edge_handles",
      edge_id: "edge",
      source_handle: "success",
      target_handle: "in",
    },
  ],
};

describe("strict local binding GraphPatch", () => {
  it("applies node bindings and edge handles without mutating unrelated graph fields", () => {
    const next = applyBindingGraphPatch(nodes, edges, patch);
    expect(next.nodes[0]).toMatchObject({
      id: "executor",
      position: { x: 10, y: 20 },
      config: {
        label: "Executor",
        assuranceOperationId: "analyze",
        assuranceOperationVersion: "1.0.0",
      },
    });
    expect(next.nodes[1]).toBe(nodes[1]);
    expect(next.edges[0]).toMatchObject({ sourceHandle: "success", targetHandle: "in" });
    expect(nodes[0].config.model).toBe("legacy-model");
    expect(edges[0].sourceHandle).toBeUndefined();
  });

  it("rejects duplicate operations and graph entries that no longer match preview", () => {
    expect(() =>
      applyBindingGraphPatch(nodes, edges, {
        ...patch,
        node_operations: [...patch.node_operations, patch.node_operations[0]],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      applyBindingGraphPatch(
        [{ ...nodes[0], type: "router" }, nodes[1]],
        edges,
        patch,
      ),
    ).toThrow(/no longer matches/);
  });

  it("rejects noncanonical base hashes and unresolved handles", () => {
    expect(() =>
      applyBindingGraphPatch(nodes, edges, { ...patch, base_source_graph_hash: "stale" }),
    ).toThrow(/base hash/);
    expect(() =>
      applyBindingGraphPatch(nodes, edges, {
        ...patch,
        edge_operations: [{ ...patch.edge_operations[0], source_handle: "" }],
      }),
    ).toThrow(/explicit/);
  });

  it("fails closed when the semantic graph hash changed after preview", () => {
    expect(() => assertBindingGraphPatchBase(patch, "b".repeat(64))).toThrow(
      /changed after.*previewed/,
    );
    expect(() => assertBindingGraphPatchBase(patch, "a".repeat(64))).not.toThrow();
  });
});

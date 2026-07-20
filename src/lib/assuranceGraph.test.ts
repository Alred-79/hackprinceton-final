import { describe, expect, it } from "vitest";
import { canonicalJson, normalizeSemanticGraph, semanticGraphHash, semanticGraphIdentity, serializeSimulatorGraph } from "./assuranceGraph";
import type { SimEdge, SimNode } from "@/types/simulator";

const nodes: SimNode[] = [
  {
    id: "executor-1",
    type: "executor",
    position: { x: 100, y: 200 },
    config: {
      label: "Analyze",
      assuranceOperationId: "analyze_threat",
      assuranceOperationVersion: "1.0.0",
      executorAssurance: {
        enabled: true,
        contractId: "threat_report",
        contractVersion: "1.0.0",
        strict: true,
        outputMode: "tool",
        validationRetries: 1,
      },
    },
  },
  { id: "output-1", type: "output", position: { x: 400, y: 200 }, config: { label: "Output" }, locked: true },
];

const edges: SimEdge[] = [{ id: "edge-1", source: "executor-1", target: "output-1", sourceHandle: "success" }];

describe("assurance graph serialization", () => {
  it("uses the current graph and emits strict snake_case assurance config", () => {
    const graph = serializeSimulatorGraph(nodes, edges);
    expect(graph.nodes[0].config).toMatchObject({
      assurance_operation_id: "analyze_threat",
      assurance_operation_version: "1.0.0",
      assurance: {
        contract_id: "threat_report",
        validation_retries: 1,
      },
    });
    expect(graph.edges[0].source_handle).toBe("success");
  });

  it("serializes a configured Knowledge Retrieval strategy onto the runtime wire", () => {
    const retrieval: SimNode = {
      id: "knowledge-1",
      type: "tool_rag",
      position: { x: 0, y: 0 },
      config: {
        label: "Knowledge Retrieval",
        assuranceOperationId: "retrieve_intel_knowledge",
        assuranceOperationVersion: "1.0.0",
        retrievalMode: "bm25",
        kValue: 3,
      },
    };
    expect(serializeSimulatorGraph([retrieval], []).nodes[0].config).toMatchObject({
      retrieval_mode: "bm25",
      k_value: 3,
    });
  });

  it("actively clears deprecated free-form output schema metadata", () => {
    const legacy = structuredClone(nodes);
    legacy[0].config.outputSchema = '{"type":"object"}';
    expect(serializeSimulatorGraph(legacy, edges).nodes[0].config.output_schema).toBeNull();
  });

  it("excludes positions from semantic identity", () => {
    const moved = structuredClone(nodes);
    moved[0].position = { x: 999, y: -20 };
    expect(semanticGraphIdentity(moved, edges)).toBe(semanticGraphIdentity(nodes, edges));
  });

  it("includes assurance config and routing in semantic identity", () => {
    const changedNode = structuredClone(nodes);
    changedNode[0].config.executorAssurance!.validationRetries = 2;
    expect(semanticGraphIdentity(changedNode, edges)).not.toBe(semanticGraphIdentity(nodes, edges));

    const changedEdge = structuredClone(edges);
    changedEdge[0].sourceHandle = "failure";
    expect(semanticGraphIdentity(nodes, changedEdge)).not.toBe(semanticGraphIdentity(nodes, edges));
  });

  it("sorts stable IDs and object keys deterministically", () => {
    const graph = serializeSimulatorGraph(nodes, edges);
    const reversed = serializeSimulatorGraph([...nodes].reverse(), [...edges].reverse());
    expect(canonicalJson(normalizeSemanticGraph(reversed))).toBe(canonicalJson(normalizeSemanticGraph(graph)));
  });

  it("rejects noncanonical wire decimals before hashing", () => {
    expect(() => serializeSimulatorGraph(nodes, [{ ...edges[0], routeProbability: "0.50" }])).toThrow(/non-canonical/);
    expect(serializeSimulatorGraph(nodes, [{ ...edges[0], routeProbability: "0.5" }]).edges[0].route_probability).toBe("0.5");
  });

  it("anchors GraphPatch preview to a stable semantic base hash", async () => {
    const first = await semanticGraphHash(nodes, edges);
    const moved = structuredClone(nodes);
    moved[0].position.x += 500;
    expect(await semanticGraphHash(moved, edges)).toBe(first);
    const rebound = structuredClone(nodes);
    rebound[0].config.assuranceOperationId = "different-operation";
    expect(await semanticGraphHash(rebound, edges)).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

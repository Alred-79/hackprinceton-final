import type { AssuranceCapabilities, SimulatorGraphWire } from "@/types/assurance";
import type { NodeConfig, SimEdge, SimNode } from "@/types/simulator";

const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;

function definedEntries(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function configToWire(node: SimNode): Record<string, unknown> {
  const c: NodeConfig = node.config;
  const bound = definedEntries({
    label: c.label,
    assurance_operation_id: c.assuranceOperationId,
    assurance_operation_version: c.assuranceOperationVersion,
  });
  if (node.type === "typed_handoff_gate" && c.typedHandoffGate) {
    return {
      label: c.label,
      contract_id: c.typedHandoffGate.contractId,
      contract_version: c.typedHandoffGate.contractVersion,
      validation_method: c.typedHandoffGate.validationMethod,
      strict: c.typedHandoffGate.strict,
      reject_behavior: c.typedHandoffGate.rejectBehavior,
    };
  }
  if (node.type === "evidence_check" && c.evidenceCheck) {
    return {
      label: c.label,
      check_ids: c.evidenceCheck.checkIds,
      aggregation: c.evidenceCheck.aggregation,
      check_weights: c.evidenceCheck.checkWeights,
      passing_score: c.evidenceCheck.passingScore ?? null,
      failure_behavior: c.evidenceCheck.failureBehavior,
    };
  }
  if (node.type === "executor") {
    return {
      ...bound,
      model: c.model ?? "",
      system_prompt: c.systemPrompt ?? "",
      tools: c.tools ?? [],
      assurance: c.executorAssurance ? {
        enabled: c.executorAssurance.enabled,
        contract_id: c.executorAssurance.contractId,
        contract_version: c.executorAssurance.contractVersion,
        strict: c.executorAssurance.strict,
        output_mode: c.executorAssurance.outputMode,
        validation_retries: c.executorAssurance.validationRetries,
      } : null,
      // The deprecated free-form field is accepted by the runtime only for import
      // compatibility. New executable graphs always clear it.
      output_schema: null,
    };
  }
  if (node.type === "evaluator") return { ...bound, model: c.model ?? null, evaluation_prompt: c.evaluationPrompt ?? "", pass_fail_criteria: c.passFailCriteria ?? "" };
  if (node.type === "router") return { ...bound, model: c.model ?? "", routing_prompt: c.routingPrompt ?? "", routes: c.routes ?? [] };
  if (node.type === "mcp_server") return { ...bound, served_tools: c.servedTools ?? [] };
  if (node.type === "tool_rag") return { ...bound, k_value: c.kValue ?? 5, retrieval_mode: c.retrievalMode ?? "hybrid" };
  if (node.type === "api_call") return { ...bound, endpoint: c.endpoint ?? "" };
  if (node.type === "code_exec") return { ...bound, validator_id: c.validatorId ?? "" };
  if (node.type === "context_gate") return { ...bound, context_gate_mode: c.contextGateMode ?? "", handoff_brief: c.handoffBrief ?? "" };
  if (node.type === "human_review") return { ...bound, review_type: c.reviewType ?? "approval" };
  return bound;
}

export function serializeSimulatorGraph(nodes: SimNode[], edges: SimEdge[]): SimulatorGraphWire {
  return {
    schema_version: "simulator.graph.v1",
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      config: configToWire(node),
      position: { x: node.position.x, y: node.position.y },
      locked: node.locked ?? false,
    })),
    edges: edges.map((edge) => {
      if (edge.routeProbability !== undefined && !DECIMAL.test(edge.routeProbability)) {
        throw new Error(`Edge ${edge.id} has a non-canonical route probability.`);
      }
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        source_handle: edge.sourceHandle ?? null,
        target_handle: edge.targetHandle ?? null,
        kind: edge.kind ?? "normal",
        fan_out: edge.fanOut ?? null,
        route_probability: edge.routeProbability ?? null,
        max_attempts: edge.maxAttempts ?? null,
      };
    }),
  };
}

function normalizeStrings(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key.normalize("NFC"), normalizeStrings(item)]),
    );
  }
  return value;
}

export function normalizeSemanticGraph(graph: SimulatorGraphWire): Omit<SimulatorGraphWire, "nodes"> & {
  nodes: Array<Omit<SimulatorGraphWire["nodes"][number], "position" | "locked">>;
} {
  return normalizeStrings({
    schema_version: graph.schema_version,
    nodes: [...graph.nodes]
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(({ position: _position, locked: _locked, ...node }) => node),
    edges: [...graph.edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  }) as Omit<SimulatorGraphWire, "nodes"> & {
    nodes: Array<Omit<SimulatorGraphWire["nodes"][number], "position" | "locked">>;
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeStrings(value));
}

function withInferredUnambiguousHandles(
  graph: SimulatorGraphWire,
  nodes: SimNode[],
  capabilities: AssuranceCapabilities,
): SimulatorGraphWire {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ports = (node: SimNode | undefined, direction: "input" | "output"): string[] => {
    if (!node) return [];
    if (node.type === "typed_handoff_gate") return direction === "input" ? ["in"] : ["pass", "rejected"];
    if (node.type === "evidence_check") return direction === "input" ? ["in"] : ["pass", "failed"];
    const operation = capabilities.operations.find((item) =>
      item.node_type === node.type &&
      item.operation_id === node.config.assuranceOperationId &&
      item.operation_version === node.config.assuranceOperationVersion
    );
    return operation?.ports?.filter((port) => port.direction === direction).map((port) => port.id) ?? [];
  };
  return {
    ...graph,
    edges: graph.edges.map((edge) => {
      const sourcePorts = ports(byId.get(edge.source), "output");
      const targetPorts = ports(byId.get(edge.target), "input");
      return {
        ...edge,
        source_handle: edge.source_handle ?? (sourcePorts.length === 1 ? sourcePorts[0] : null),
        target_handle: edge.target_handle ?? (targetPorts.length === 1 ? targetPorts[0] : null),
      };
    }),
  };
}

export function semanticGraphIdentity(
  nodes: SimNode[],
  edges: SimEdge[],
  capabilities?: AssuranceCapabilities | null,
): string {
  const graph = serializeSimulatorGraph(nodes, edges);
  return canonicalJson(normalizeSemanticGraph(capabilities ? withInferredUnambiguousHandles(graph, nodes, capabilities) : graph));
}

export async function semanticGraphHash(
  nodes: SimNode[],
  edges: SimEdge[],
  capabilities?: AssuranceCapabilities | null,
): Promise<string> {
  const bytes = new TextEncoder().encode(semanticGraphIdentity(nodes, edges, capabilities));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function graphSnapshot(nodes: SimNode[], edges: SimEdge[]): { nodes: SimNode[]; edges: SimEdge[] } {
  return { nodes: structuredClone(nodes), edges: structuredClone(edges) };
}

import type { DeterministicResults, Scenario, SimEdge, SimNode } from "@/types/simulator";
import { getModelById } from "@/data/models";
import {
  countChainedExecutorsWithoutGate,
  detectCycles,
  getAdjacencyList,
  getDisconnectedNodes,
  getIncomingMap,
  topologicalSort,
} from "./graphUtils";

const ASSUMED_INPUT_TOKENS = 1_000;
const ASSUMED_OUTPUT_TOKENS = 500;
const BOUNDED_LOOP_ATTEMPTS = 3;

function isGenerative(node: SimNode) {
  return node.type === "executor" || node.type === "evaluator" || node.type === "router";
}

function estimatedModelCost(node: SimNode): number {
  const model = getModelById(node.config.model || "gpt-4o");
  if (!model) return 0;
  return calculateTokenCost(
    ASSUMED_INPUT_TOKENS,
    ASSUMED_OUTPUT_TOKENS,
    model.inputPricePerMillion,
    model.outputPricePerMillion,
  );
}

export function calculateTokenCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
) {
  return (
    inputTokens * inputPricePerMillion + outputTokens * outputPricePerMillion
  ) / 1_000_000;
}

function assumedNodeLatency(node: SimNode): number {
  if (isGenerative(node)) {
    return getModelById(node.config.model || "gpt-4o")?.assumedLatencySeconds ?? 1;
  }
  const assumptions: Partial<Record<SimNode["type"], number>> = {
    web_search: 2,
    file_rw: 0.5,
    tool_rag: 1,
    code_exec: 1.5,
    api_call: 0.8,
    kafka_stream: 0.3,
    mcp_server: 0.5,
  };
  // Human wait is deliberately excluded until the user supplies a value.
  return assumptions[node.type] ?? 0;
}

export function criticalPathLatency(nodes: SimNode[], edges: SimEdge[]): number {
  const order = topologicalSort(nodes, edges);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = getIncomingMap(nodes, edges);
  const finish = new Map<string, number>();

  for (const nodeId of order) {
    const predecessors = incoming.get(nodeId) ?? [];
    const predecessorFinish = Math.max(0, ...predecessors.map((id) => finish.get(id) ?? 0));
    const node = nodeMap.get(nodeId);
    finish.set(nodeId, predecessorFinish + (node ? assumedNodeLatency(node) : 0));
  }
  return Math.max(0, ...finish.values());
}

export function computeDeterministicResults(
  nodes: SimNode[],
  edges: SimEdge[],
  scenario: Scenario,
): DeterministicResults {
  const bonuses: Array<{ label: string; value: number }> = [];
  const penalties: Array<{ label: string; value: number }> = [];
  const warnings: string[] = [];
  const cycles = detectCycles(nodes, edges);
  const cycleNodeIds = new Set(cycles.flat());
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  const baseCost = nodes.filter(isGenerative).reduce((sum, node) => sum + estimatedModelCost(node), 0);
  const repeatedCycleCost = nodes
    .filter((node) => cycleNodeIds.has(node.id) && isGenerative(node))
    .reduce((sum, node) => sum + estimatedModelCost(node) * (BOUNDED_LOOP_ATTEMPTS - 1), 0);
  const costLow = baseCost;
  const costHigh = baseCost + repeatedCycleCost;

  const baseLatency = criticalPathLatency(nodes, edges);
  const repeatedCycleLatency = nodes
    .filter((node) => cycleNodeIds.has(node.id))
    .reduce((sum, node) => sum + assumedNodeLatency(node) * (BOUNDED_LOOP_ATTEMPTS - 1), 0);
  const latencyLow = baseLatency;
  const latencyHigh = baseLatency + repeatedCycleLatency;

  let scenarioReadiness = 100;
  const disconnected = getDisconnectedNodes(nodes, edges);
  if (disconnected.length > 0) {
    const points = disconnected.length * 10;
    scenarioReadiness -= points;
    penalties.push({ label: `${disconnected.length} disconnected node(s)`, value: -points });
    warnings.push(`${disconnected.length} node(s) are isolated from the graph.`);
  }

  const cyclesWithoutEvaluator = cycles.filter((cycle) =>
    !cycle.some((id) => nodeMap.get(id)?.type === "evaluator"),
  );
  if (cyclesWithoutEvaluator.length > 0) {
    scenarioReadiness -= 50;
    penalties.push({ label: "Cycle lacks an evaluator/termination signal", value: -50 });
    warnings.push("Cycle bounds are assumed for estimation; this graph is not executable as drawn.");
  }

  const brainNodes = nodes.filter(isGenerative);
  const emptyPromptNodes = brainNodes.filter((node) => {
    if (node.type === "executor") return !node.config.systemPrompt?.trim();
    if (node.type === "evaluator") {
      return !node.config.evaluationPrompt?.trim() && !node.config.passFailCriteria?.trim();
    }
    return !node.config.routingPrompt?.trim();
  });
  if (emptyPromptNodes.length > 0) {
    const points = emptyPromptNodes.length * 5;
    scenarioReadiness -= points;
    penalties.push({ label: `${emptyPromptNodes.length} generative node(s) lack prompts`, value: -points });
  }

  const chainLength = countChainedExecutorsWithoutGate(nodes, edges);
  if (chainLength >= 4) {
    const points = (chainLength - 3) * 5;
    scenarioReadiness -= points;
    penalties.push({ label: `${chainLength} executors without a context boundary`, value: -points });
    warnings.push("Long generative chains increase context exposure; no probability is inferred.");
  }

  if (scenario.failureSequence && !nodes.some((node) => node.type === "fallback_router")) {
    scenarioReadiness -= 10;
    penalties.push({ label: "Known fixture failure lacks an explicit fallback path", value: -10 });
  }

  for (const node of nodes.filter((item) => item.type === "mcp_server")) {
    const tools = node.config.servedTools?.length ?? 0;
    warnings.push(`${node.config.label} exposes ${tools} tool schema(s); no quality bonus is assigned.`);
  }
  if (nodes.some((node) => node.type === "human_review")) {
    warnings.push("Human wait time is not estimated without an explicit user assumption.");
  }
  if (edges.some((edge) => (getAdjacencyList(nodes, edges).get(edge.source)?.length ?? 0) > 1)) {
    warnings.push("Route probabilities are unspecified; cost and latency are shown as assumption-bound ranges.");
  }

  scenarioReadiness = Math.max(0, Math.min(100, scenarioReadiness));
  return {
    cost: Math.round(costHigh * 1_000_000) / 1_000_000,
    latency: Math.round(latencyHigh * 10) / 10,
    scenarioReadiness: Math.round(scenarioReadiness),
    metricLabels: {
      cost: "estimate",
      latency: "estimate",
      scenarioReadiness: "heuristic",
      taskPass: "not_measured",
    },
    intervals: {
      cost: { low: costLow, high: costHigh },
      latency: { low: latencyLow, high: latencyHigh },
    },
    assumptions: [
      `${ASSUMED_INPUT_TOKENS} input and ${ASSUMED_OUTPUT_TOKENS} output tokens per generative visit.`,
      "Legacy dated price profile (2024-08-01); not current provider billing.",
      `Cycles are capped at ${BOUNDED_LOOP_ATTEMPTS} visits for the displayed range.`,
      "Tool fees and human wait are unknown unless observed or explicitly configured.",
    ],
    bonuses,
    penalties,
    warnings,
  };
}

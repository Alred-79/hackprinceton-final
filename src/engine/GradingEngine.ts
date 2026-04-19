import type { SimNode, SimEdge, DeterministicResults, Scenario } from "@/types/simulator";
import { getModelById } from "@/data/models";
import {
  detectCycles,
  getDisconnectedNodes,
  countChainedExecutorsWithoutGate,
  getAdjacencyList,
} from "./graphUtils";

const LOOP_ITERATIONS = 3;

export function computeDeterministicResults(
  nodes: SimNode[],
  edges: SimEdge[],
  scenario: Scenario
): DeterministicResults {
  const bonuses: Array<{ label: string; value: number }> = [];
  const penalties: Array<{ label: string; value: number }> = [];
  const warnings: string[] = [];

  // --- Cost calculation ---
  let totalCost = 0;
  const cycles = detectCycles(nodes, edges);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const cycleNodeIds = new Set(cycles.flat());

  nodes.forEach((n) => {
    if (n.type === "executor" || n.type === "evaluator" || n.type === "router") {
      const model = getModelById(n.config.model || "gpt-4o");
      if (model) {
        const loopMultiplier = cycleNodeIds.has(n.id) ? LOOP_ITERATIONS : 1;
        totalCost += model.costPer1kTokens * loopMultiplier;
      }
    }
    // Tool nodes have small fixed costs
    if (n.type === "web_search") totalCost += 0.1;
    if (n.type === "file_rw") totalCost += 0.05;
    if (n.type === "tool_rag") totalCost += 0.2;
    if (n.type === "code_exec") totalCost += 0.15;
    if (n.type === "api_call") totalCost += 0.08;
    if (n.type === "human_review") totalCost += 0; // free
    if (n.type === "mcp_server") {
      totalCost += 0.30; // coordination overhead
      const served = n.config.servedTools || [];
      served.forEach((t) => {
        if (t === "web_search") totalCost += 0.1;
        if (t === "file_rw") totalCost += 0.05;
        if (t === "tool_rag") totalCost += 0.2;
        if (t === "code_exec") totalCost += 0.15;
        if (t === "api_call") totalCost += 0.08;
      });
    }
  });

  // --- Latency calculation ---
  const adj = getAdjacencyList(nodes, edges);

  let totalLatency = 0;
  // Simple path-based latency: sum along longest path
  function getNodeLatency(n: SimNode): number {
    if (n.type === "executor" || n.type === "evaluator" || n.type === "router") {
      const model = getModelById(n.config.model || "gpt-4o");
      return model ? model.avgLatency : 1.0;
    }
    if (n.type === "web_search") return 2.0;
    if (n.type === "file_rw") return 0.5;
    if (n.type === "tool_rag") return 1.0;
    if (n.type === "code_exec") return 1.5;
    if (n.type === "api_call") return 0.8;
    if (n.type === "human_review") return 30.0; // human wait time
    if (n.type === "mcp_server") {
      // coordination hop + max served tool latency
      const served = n.config.servedTools || [];
      const toolLatencies: Record<string, number> = { web_search: 2.0, file_rw: 0.5, tool_rag: 1.0, code_exec: 1.5, api_call: 0.8 };
      const maxToolLat = served.reduce((mx, t) => Math.max(mx, toolLatencies[t] || 0), 0);
      return 0.5 + maxToolLat;
    }
    return 0;
  }

  // BFS-based longest path
  const longestPath = new Map<string, number>();
  nodes.forEach((n) => longestPath.set(n.id, 0));

  // For nodes with multiple outgoing edges (parallel), take max of children
  // For sequential, sum them
  const inputNode = nodes.find((n) => n.type === "input");
  if (inputNode) {
    const queue = [inputNode.id];
    longestPath.set(inputNode.id, 0);
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const currentLatency = longestPath.get(current) || 0;
      const neighbors = adj.get(current) || [];

      for (const neighbor of neighbors) {
        const neighborNode = nodeMap.get(neighbor);
        if (!neighborNode) continue;

        const loopMultiplier = cycleNodeIds.has(neighbor) ? LOOP_ITERATIONS : 1;
        const adjustedLatency = currentLatency + getNodeLatency(neighborNode) * loopMultiplier;

        if (adjustedLatency > (longestPath.get(neighbor) || 0)) {
          longestPath.set(neighbor, adjustedLatency);
        }
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    totalLatency = Math.max(...Array.from(longestPath.values()));
  }

  // --- Reliability calculation ---
  let reliability = 100;

  // Disconnected nodes penalty
  const disconnected = getDisconnectedNodes(nodes, edges);
  if (disconnected.length > 0) {
    const penalty = disconnected.length * 5;
    penalties.push({ label: `${disconnected.length} disconnected node(s)`, value: -penalty });
    reliability -= penalty;
    warnings.push(`${disconnected.length} node(s) are not connected to the graph`);
  }

  // Cycle detection
  const cyclesWithoutEvaluator = cycles.filter((cycle) => {
    return !cycle.some((id) => {
      const n = nodeMap.get(id);
      return n && n.type === "evaluator";
    });
  });

  if (cyclesWithoutEvaluator.length > 0) {
    penalties.push({ label: "Loop without Evaluator", value: -100 });
    reliability = 0;
    warnings.push("Cycle detected without an Evaluator node - infinite loop risk!");
  }

  // Evaluator bonuses (stacking: first +25%, second +10%, third+ +2%)
  const evaluators = nodes.filter((n) => n.type === "evaluator");
  evaluators.forEach((ev, i) => {
    const bonus = i === 0 ? 25 : i === 1 ? 10 : 2;
    bonuses.push({ label: `Evaluator: ${ev.config.label}`, value: bonus });
    // Optimistic bonus (may be removed after LLM check)
  });
  const evalBonus = evaluators.reduce((sum, _, i) => sum + (i === 0 ? 25 : i === 1 ? 10 : 2), 0);

  // Context gate bonus (+5% per gate)
  const gates = nodes.filter((n) => n.type === "context_gate");
  gates.forEach((g) => {
    if (g.config.contextGateMode) {
      bonuses.push({ label: `Context Gate: ${g.config.label}`, value: 5 });
    }
  });
  const gateBonus = gates.filter((g) => g.config.contextGateMode).length * 5;

  // Tool count penalties
  nodes.forEach((n) => {
    if (n.type === "executor") {
      const toolCount = (n.config.tools || []).length;
      if (toolCount >= 10) {
        const penalty = 15 + (toolCount - 10) * 3;
        penalties.push({ label: `${n.config.label}: ${toolCount} tools`, value: -penalty });
        reliability -= penalty;
      }
    }
  });

  // Output schema bonus (structural guarantees beat runtime checks)
  const schemaNodes = nodes.filter((n) =>
    (n.type === "executor" || n.type === "evaluator") && n.config.outputSchema?.trim()
  );
  let schemaBonus = 0;
  schemaNodes.forEach((n, i) => {
    try {
      JSON.parse(n.config.outputSchema!);
      const bonus = i === 0 ? 8 : 3;
      bonuses.push({ label: `Schema: ${n.config.label}`, value: bonus });
      schemaBonus += bonus;
    } catch {
      warnings.push(`${n.config.label}: outputSchema is not valid JSON`);
    }
  });

  // Chained executors without gate
  const chainLength = countChainedExecutorsWithoutGate(nodes, edges);
  if (chainLength >= 4) {
    const penalty = (chainLength - 3) * 5;
    penalties.push({ label: `${chainLength} chained Executors without Context Gate`, value: -penalty });
    reliability -= penalty;
    warnings.push("Long chain of Executors without a Context Gate may cause context overflow");
  }

  // Fallback router bonus for failure scenarios
  if (scenario.failureSequence) {
    const hasFallback = nodes.some((n) => n.type === "fallback_router");
    if (hasFallback) {
      bonuses.push({ label: "Fallback Router for failure handling", value: 15 });
    } else {
      penalties.push({ label: "No fallback for unreliable tool", value: -20 });
      reliability -= 20;
    }
  }

  // Human review bonus: +15% when before high-stakes output, -5% when unnecessary
  const humanNodes = nodes.filter((n) => n.type === "human_review");
  humanNodes.forEach((hr) => {
    // Check if this human review connects toward output
    const outgoing = edges.filter((e) => e.source === hr.id);
    const reachesOutput = outgoing.some((e) => {
      const target = nodeMap.get(e.target);
      if (!target) return false;
      if (target.type === "output") return true;
      // Check one more hop
      return edges.some((e2) => e2.source === e.target && nodeMap.get(e2.target)?.type === "output");
    });
    // Check if a router with "Critical" or "Urgent" routes exists upstream
    const hasHighStakesPath = nodes.some((n) =>
      n.type === "router" && (n.config.routes || []).some((r) =>
        /critical|urgent|p1|p2/i.test(r)
      )
    );
    if (reachesOutput && hasHighStakesPath) {
      bonuses.push({ label: `Human Review: ${hr.config.label} (high-stakes sign-off)`, value: 15 });
    } else if (reachesOutput) {
      bonuses.push({ label: `Human Review: ${hr.config.label} (quality gate)`, value: 5 });
    }
  });

  // MCP server bonus/penalty
  const mcpNodes = nodes.filter((n) => n.type === "mcp_server");
  mcpNodes.forEach((mcp) => {
    const served = (mcp.config.servedTools || []).length;
    if (served >= 3) {
      bonuses.push({ label: `MCP Server: ${mcp.config.label} (${served} tools)`, value: 5 });
    } else if (served <= 1) {
      penalties.push({ label: `MCP Server: ${mcp.config.label} (overhead, only ${served} tool)`, value: -3 });
      reliability -= 3;
    }
  });

  // Add bonuses to reliability
  const humanBonus = humanNodes.reduce((sum, hr) => {
    const outgoing = edges.filter((e) => e.source === hr.id);
    const reachesOutput = outgoing.some((e) => {
      const target = nodeMap.get(e.target);
      if (!target) return false;
      if (target.type === "output") return true;
      return edges.some((e2) => e2.source === e.target && nodeMap.get(e2.target)?.type === "output");
    });
    const hasHighStakesPath = nodes.some((n) =>
      n.type === "router" && (n.config.routes || []).some((r) => /critical|urgent|p1|p2/i.test(r))
    );
    if (!reachesOutput) return sum;
    return sum + (hasHighStakesPath ? 15 : 5);
  }, 0);
  const mcpBonus = mcpNodes.reduce((sum, mcp) => {
    const served = (mcp.config.servedTools || []).length;
    return sum + (served >= 3 ? 5 : 0);
  }, 0);
  reliability += evalBonus + gateBonus + schemaBonus + humanBonus + mcpBonus;
  reliability = Math.max(0, Math.min(100, reliability));

  // Model reliability contribution
  const brainNodes = nodes.filter((n) => ["executor", "evaluator", "router"].includes(n.type));
  if (brainNodes.length > 0) {
    const avgModelReliability =
      brainNodes.reduce((sum, n) => {
        const model = getModelById(n.config.model || "gpt-4o");
        return sum + (model ? model.reliability * 100 : 95);
      }, 0) / brainNodes.length;
    
    // Weighted average with architecture reliability
    reliability = Math.min(reliability, avgModelReliability);
  }

  // Empty prompt penalty (approximation - LLM does the real check)
  const emptyPromptNodes = brainNodes.filter((n) => {
    if (n.type === "executor") return !n.config.systemPrompt;
    if (n.type === "evaluator") return !n.config.evaluationPrompt && !n.config.passFailCriteria;
    if (n.type === "router") return !n.config.routingPrompt;
    return false;
  });

  if (emptyPromptNodes.length > 0) {
    warnings.push(`${emptyPromptNodes.length} brain node(s) have empty prompts`);
  }

  return {
    cost: Math.round(totalCost * 100) / 100,
    latency: Math.round(totalLatency * 10) / 10,
    reliability: Math.round(Math.max(0, Math.min(100, reliability))),
    bonuses,
    penalties,
    warnings,
  };
}

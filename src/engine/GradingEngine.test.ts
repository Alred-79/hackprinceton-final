import { describe, expect, it } from "vitest";
import type { Scenario, SimEdge, SimNode } from "@/types/simulator";
import {
  calculateTokenCost,
  computeDeterministicResults,
  criticalPathLatency,
} from "./GradingEngine";

const node = (id: string, type: SimNode["type"], model?: string): SimNode => ({
  id,
  type,
  config: { label: id, model, systemPrompt: type === "executor" ? "Do the task." : undefined },
  position: { x: 0, y: 0 },
});

const scenario = {
  id: "test",
  title: "Test",
  brief: "Test",
  description: "Test",
  mode: "architect",
  expectedInputs: "input",
  expectedOutputs: "output",
  availableNodeTypes: [],
  hints: [],
  maxCost: 10,
  maxLatency: 20,
  minReliability: 0,
  llmThresholds: { minPromptScore: 0, minArchitectureScore: 0 },
} satisfies Scenario;

describe("honest heuristic engine", () => {
  it("uses per-million input and output prices dimensionally", () => {
    expect(calculateTokenCost(1_000, 500, 2, 8)).toBe(0.006);
  });

  it("uses the maximum parallel branch, not the sum", () => {
    const nodes = [
      node("input", "input"),
      node("two-seconds", "web_search"),
      node("four-seconds", "executor", "o1-mini"),
      node("join", "tool_rag"),
      node("output", "output"),
    ];
    const edges: SimEdge[] = [
      { id: "1", source: "input", target: "two-seconds" },
      { id: "2", source: "input", target: "four-seconds" },
      { id: "3", source: "two-seconds", target: "join" },
      { id: "4", source: "four-seconds", target: "join" },
      { id: "5", source: "join", target: "output" },
    ];
    expect(criticalPathLatency(nodes, edges)).toBe(5);
  });

  it("is invariant to node insertion order", () => {
    const nodes = [node("input", "input"), node("agent", "executor", "gpt-4o"), node("output", "output")];
    const edges: SimEdge[] = [
      { id: "1", source: "input", target: "agent" },
      { id: "2", source: "agent", target: "output" },
    ];
    const forward = computeDeterministicResults(nodes, edges, scenario);
    const reversed = computeDeterministicResults([...nodes].reverse(), edges, scenario);
    expect(reversed.cost).toBe(forward.cost);
    expect(reversed.latency).toBe(forward.latency);
    expect(reversed.scenarioReadiness).toBe(forward.scenarioReadiness);
  });

  it("labels estimates, heuristics, and unmeasured outcomes", () => {
    const result = computeDeterministicResults(
      [node("input", "input"), node("output", "output")],
      [{ id: "1", source: "input", target: "output" }],
      scenario,
    );
    expect(result.metricLabels).toEqual({
      cost: "estimate",
      latency: "estimate",
      scenarioReadiness: "heuristic",
      taskPass: "not_measured",
    });
  });
});

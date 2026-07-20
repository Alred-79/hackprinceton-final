import { describe, expect, it } from "vitest";
import type { RuntimeCapabilities } from "@/types/runtime";
import { isScenarioExecutable } from "./runtimeScenarios";

const capabilities: RuntimeCapabilities = {
  executable_scenarios: ["future-scenario"],
  design_only_scenarios: ["threat-analyst", "safety-net"],
  contracts: [],
  guarantees: [],
  operations: [],
  limitations: [],
  scenario_runtimes: [],
};

describe("isScenarioExecutable", () => {
  it("keeps the locally registered flagship executable while the API is offline", () => {
    expect(isScenarioExecutable("threat-analyst", null)).toBe(true);
  });

  it("keeps every locally registered scenario executable while the API is offline", () => {
    expect(isScenarioExecutable("safety-net", null)).toBe(true);
    expect(isScenarioExecutable("not-registered", null)).toBe(false);
  });

  it("treats live capability metadata as authoritative", () => {
    expect(isScenarioExecutable("future-scenario", capabilities)).toBe(true);
    expect(isScenarioExecutable("threat-analyst", capabilities)).toBe(false);
  });
});

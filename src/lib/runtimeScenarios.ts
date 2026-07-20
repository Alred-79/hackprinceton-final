import type { RuntimeCapabilities } from "@/types/runtime";

const LOCALLY_EXECUTABLE_SCENARIOS = new Set([
  "threat-analyst",
  "bloated-swarm",
  "content-machine",
  "due-diligence-engine",
  "gold-plater",
  "mcp-migration",
  "ops-center",
  "safety-net",
]);

export function isScenarioExecutable(
  scenarioId: string,
  capabilities: RuntimeCapabilities | null,
): boolean {
  if (capabilities) return capabilities.executable_scenarios.includes(scenarioId);
  return LOCALLY_EXECUTABLE_SCENARIOS.has(scenarioId);
}

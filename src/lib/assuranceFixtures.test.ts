import { describe, expect, it } from "vitest";
import { defaultAssuranceInput } from "./assuranceApi";

const scenarios = [
  "threat-analyst",
  "bloated-swarm",
  "content-machine",
  "due-diligence-engine",
  "gold-plater",
  "mcp-migration",
  "ops-center",
  "safety-net",
];

describe("assurance causal fixtures", () => {
  it.each(scenarios)("keeps %s input discriminator strict", (scenario) => {
    expect(defaultAssuranceInput(scenario).kind).toBe(scenario);
  });

  it.each(scenarios)("injects an explicit malformed-output marker for %s", (scenario) => {
    expect(JSON.stringify(defaultAssuranceInput(scenario, "invalid_output"))).toContain("invalid-output");
  });

  it.each(scenarios)("injects an independent evidence failure for %s", (scenario) => {
    const fixture = JSON.stringify(defaultAssuranceInput(scenario, "evidence_failure"));
    expect(fixture).not.toContain("invalid-output");
    expect(fixture).not.toBe(JSON.stringify(defaultAssuranceInput(scenario)));
  });

  it.each(scenarios)("injects an explicit post-agent handoff mutation marker for %s", (scenario) => {
    expect(JSON.stringify(defaultAssuranceInput(scenario, "handoff_drift"))).toContain("handoff-drift");
  });
});

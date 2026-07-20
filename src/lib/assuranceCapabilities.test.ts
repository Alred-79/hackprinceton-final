import { describe, expect, it } from "vitest";
import { assuranceNodeTypeSupport } from "./assuranceCapabilities";
import type { AssuranceCapabilities } from "@/types/assurance";

const capabilities: AssuranceCapabilities = {
  enabled: true,
  supported: true,
  scenario_id: "gold-plater",
  operations: [{ operation_id: "format_result", operation_version: "1.0.0", node_type: "executor", label: "Format result" }],
  output_contracts: [],
  handoff_contracts: [{ contract_id: "scope_handoff", contract_version: "1.0.0", label: "Scope" }],
  evidence_checks: [{ check_id: "authorization_scope", label: "Authorization" }],
};

describe("assurance palette filtering", () => {
  it("enables only advertised ordinary operation types", () => {
    expect(assuranceNodeTypeSupport("executor", capabilities).supported).toBe(true);
    expect(assuranceNodeTypeSupport("evaluator", capabilities)).toMatchObject({ supported: false, reason: expect.stringContaining("No registered") });
  });

  it("requires real gate contracts and evidence checks", () => {
    expect(assuranceNodeTypeSupport("typed_handoff_gate", capabilities).supported).toBe(true);
    expect(assuranceNodeTypeSupport("evidence_check", { ...capabilities, evidence_checks: [] }).supported).toBe(false);
  });
});

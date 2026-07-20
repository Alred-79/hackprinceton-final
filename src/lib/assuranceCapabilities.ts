import type { AssuranceCapabilities } from "@/types/assurance";
import type { SimNodeType } from "@/types/simulator";

export function assuranceNodeTypeSupport(
  type: SimNodeType,
  capabilities?: AssuranceCapabilities | null,
): { supported: boolean; reason?: string } {
  if (!capabilities?.supported) return { supported: false, reason: capabilities?.unsupported_reason ?? "Scenario adapter unavailable" };
  if (type === "typed_handoff_gate") return capabilities.handoff_contracts.length
    ? { supported: true }
    : { supported: false, reason: "No registered handoff contract for this scenario" };
  if (type === "evidence_check") return capabilities.evidence_checks.length
    ? { supported: true }
    : { supported: false, reason: "No registered evidence check for this scenario" };
  return capabilities.operations.some((operation) => operation.node_type === type)
    ? { supported: true }
    : { supported: false, reason: "No registered runtime operation for this node type" };
}

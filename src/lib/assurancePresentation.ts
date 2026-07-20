import type { AssuranceEvent, AssuranceRunResult } from "@/types/assurance";
import type { EvidenceCheckAssuranceConfig } from "@/types/simulator";

export type AssuranceNodeVisualState = "idle" | "passed" | "failed" | "recovered";

export function assuranceNodeVisualState(
  events: AssuranceEvent[],
  terminalKind?: AssuranceRunResult["terminal_kind"],
): AssuranceNodeVisualState {
  const failureIndexes = events.flatMap((event, index) => {
    const evidenceFailed = event.event_type === "evidence_check_result" && event.payload?.decision === false;
    return /rejected|failed/.test(event.event_type) || evidenceFailed ? [index] : [];
  });
  const successIndexes = events.flatMap((event, index) => {
    const evidencePassed = event.event_type === "evidence_check_result" && event.payload?.decision === true;
    return /validated|completed/.test(event.event_type) || evidencePassed ? [index] : [];
  });
  const lastFailure = failureIndexes.at(-1) ?? -1;
  const lastSuccess = successIndexes.at(-1) ?? -1;
  if (lastFailure >= 0 && lastSuccess > lastFailure && terminalKind === "recovered") return "recovered";
  if (lastFailure >= 0 && lastFailure >= lastSuccess) return "failed";
  if (lastSuccess >= 0) return "passed";
  return "idle";
}

export function withEvidenceAggregation(
  config: EvidenceCheckAssuranceConfig,
  aggregation: EvidenceCheckAssuranceConfig["aggregation"],
): EvidenceCheckAssuranceConfig {
  if (aggregation !== "weighted") {
    return { ...config, aggregation, checkWeights: {}, passingScore: undefined };
  }
  return {
    ...config,
    aggregation,
    checkWeights: Object.fromEntries(config.checkIds.map((id) => [id, config.checkWeights[id] ?? "1"])),
    passingScore: config.passingScore ?? "0.7",
  };
}

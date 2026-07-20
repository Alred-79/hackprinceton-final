import { describe, expect, it } from "vitest";
import { assuranceNodeVisualState, withEvidenceAggregation } from "./assurancePresentation";
import type { AssuranceEvent } from "@/types/assurance";

const event = (sequence: number, event_type: string, payload: Record<string, unknown> = {}): AssuranceEvent => ({ sequence, event_type, payload });

describe("assurance evidence presentation", () => {
  it("renders an evidence decision=false as failed, never green", () => {
    expect(assuranceNodeVisualState([event(1, "evidence_check_result", { decision: false })], "evidence_failed")).toBe("failed");
  });

  it("renders a corrected retry as recovered rather than clean or failed", () => {
    expect(assuranceNodeVisualState([
      event(1, "executor_output_rejected"),
      event(2, "executor_retry_started"),
      event(3, "node_completed"),
    ], "recovered")).toBe("recovered");
  });

  it("keeps a later failed evidence decision red", () => {
    expect(assuranceNodeVisualState([
      event(1, "node_completed"),
      event(2, "evidence_check_result", { decision: false }),
    ], "evidence_failed")).toBe("failed");
  });

  it("materializes every weighted check and clears weighted-only fields on exit", () => {
    const base = { checkIds: ["a", "b"], aggregation: "all" as const, checkWeights: {}, failureBehavior: "stop" as const };
    const weighted = withEvidenceAggregation(base, "weighted");
    expect(weighted).toMatchObject({ aggregation: "weighted", checkWeights: { a: "1", b: "1" }, passingScore: "0.7" });
    expect(withEvidenceAggregation(weighted, "any")).toEqual({ ...base, aggregation: "any", passingScore: undefined });
  });
});

import type { ActionKind, ArchitectGraph, PolicyNodeKind } from "./types";

export const POLICY_SLOT_LIMIT = 6;

export interface PolicySlot {
  id: string;
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  compatibleKinds: PolicyNodeKind[];
  reason: string;
}

export const POLICY_BLOCK_META: Record<PolicyNodeKind, { label: string; shortLabel: string; description: string }> = {
  schema_gate: {
    label: "Schema Contract",
    shortLabel: "Schema",
    description: "Declare the expected shape after a reasoning step.",
  },
  context_gate: {
    label: "Context Boundary",
    shortLabel: "Context",
    description: "Bound what context may enter a reasoning or evaluation step.",
  },
  human_review: {
    label: "Human Review",
    shortLabel: "Review",
    description: "Represent an optional checkpoint before a side effect.",
  },
};

const mutatingOperationVerbs = new Set([
  "append",
  "commit",
  "create",
  "delete",
  "mutate",
  "patch",
  "post",
  "publish",
  "put",
  "remove",
  "replace",
  "reserve",
  "save",
  "submit",
  "update",
  "upload",
  "write",
]);

export function isReviewableSideEffect(actionKind: ActionKind, operationVerb: string): boolean {
  if (actionKind === "notification" || actionKind === "code_execution") return true;
  if (actionKind !== "api_call" && actionKind !== "file_operation") return false;
  const words = operationVerb.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((word) => mutatingOperationVerbs.has(word));
}

export function derivePolicySlots(graph: ArchitectGraph): PolicySlot[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return [...graph.edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((edge): PolicySlot[] => {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target) return [];
      const compatibleKinds: PolicyNodeKind[] = [];
      const reasons: string[] = [];
      const targetNeedsContext = target.config.type === "evaluator"
        || (target.config.type === "action" && target.config.actionKind === "reasoning");
      if (targetNeedsContext && source.kind !== "context_gate") {
        compatibleKinds.push("context_gate");
        reasons.push("Bound context before reasoning or evaluation");
      }
      if (source.config.type === "action" && source.config.actionKind === "reasoning" && target.kind !== "schema_gate") {
        compatibleKinds.push("schema_gate");
        reasons.push("Declare an output shape after reasoning");
      }
      if (
        target.config.type === "action"
        && isReviewableSideEffect(target.config.actionKind, target.config.operationVerb)
        && source.kind !== "human_review"
      ) {
        compatibleKinds.push("human_review");
        reasons.push("Optionally review before a side effect");
      }
      if (!compatibleKinds.length) return [];
      return [{
        id: `policy-slot-${edge.id}`,
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        compatibleKinds,
        reason: reasons.join("; "),
      }];
    });
}

export function selectPolicySlotsForPresentation(
  semanticSlots: readonly PolicySlot[],
  limit = POLICY_SLOT_LIMIT,
): PolicySlot[] {
  if (limit <= 0) return [];
  const ordered = [...semanticSlots].sort((a, b) => a.id.localeCompare(b.id));
  const selected: PolicySlot[] = [];
  const selectedIds = new Set<string>();
  const availableKinds = (["schema_gate", "context_gate", "human_review"] as const)
    .filter((kind) => ordered.some((slot) => slot.compatibleKinds.includes(kind)));
  for (const kind of availableKinds) {
    if (selected.length >= limit) break;
    const representative = ordered.find((slot) => (
      slot.compatibleKinds.includes(kind) && !selectedIds.has(slot.id)
    ));
    if (!representative) continue;
    selected.push(representative);
    selectedIds.add(representative.id);
  }
  for (const slot of ordered) {
    if (selected.length >= limit) break;
    if (selectedIds.has(slot.id)) continue;
    selected.push(slot);
    selectedIds.add(slot.id);
  }
  return selected.sort((a, b) => a.id.localeCompare(b.id));
}

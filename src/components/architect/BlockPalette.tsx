import { Braces, Hand, Shield } from "lucide-react";
import { derivePolicySlots, POLICY_BLOCK_META, selectPolicySlotsForPresentation } from "@/features/architect/policySlots";
import { ARCHITECT_NODE_LIMIT, type ArchitectGraph, type PolicyNodeKind } from "@/features/architect/types";

const featured: Array<{ kind: PolicyNodeKind; Icon: typeof Braces }> = [
  { kind: "schema_gate", Icon: Braces },
  { kind: "context_gate", Icon: Shield },
  { kind: "human_review", Icon: Hand },
];

export default function BlockPalette({
  selectedKind,
  graph,
  onSelect,
  onInsertPolicy,
  onDragStart,
  onDragEnd,
}: {
  selectedKind: PolicyNodeKind | null;
  graph: ArchitectGraph;
  onSelect: (kind: PolicyNodeKind) => void;
  onInsertPolicy: (edgeId: string, kind: PolicyNodeKind) => void;
  onDragStart: (kind: PolicyNodeKind, event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const nodeLabels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const capacityReached = graph.nodes.length >= ARCHITECT_NODE_LIMIT;
  const visibleSlots = selectPolicySlotsForPresentation(derivePolicySlots(graph));
  const compatibleSlots = selectedKind
    ? visibleSlots.filter((slot) => slot.compatibleKinds.includes(selectedKind))
    : [];
  return (
    <aside className="architect-palette architect-panel" aria-labelledby="architect-palette-title">
      <div className="architect-panel__heading">
        <div>
          <h3 id="architect-palette-title">Decision blocks</h3>
          <p>Drag on desktop, or select a block and activate a compatible slot.</p>
        </div>
      </div>
      <div className="architect-palette__list">
        {featured.map(({ kind, Icon }) => {
          const meta = POLICY_BLOCK_META[kind];
          return (
            <button
              key={kind}
              type="button"
              draggable
              className={`architect-palette-card${selectedKind === kind ? " is-selected" : ""}`}
              data-policy-kind={kind}
              aria-pressed={selectedKind === kind}
              aria-label={capacityReached
                ? `${meta.label} unavailable. Draft capacity reached; remove a linear node first.`
                : `Select ${meta.label} block. ${meta.description}`}
              disabled={capacityReached}
              onClick={() => onSelect(kind)}
              onDragStart={(event) => onDragStart(kind, event)}
              onDragEnd={onDragEnd}
            >
              <Icon size={16} aria-hidden="true" />
              <span><strong>{meta.label}</strong><small>{meta.description}</small></span>
            </button>
          );
        })}
      </div>
      <p className="architect-palette__selection" role="status">
        {capacityReached
          ? `Draft capacity reached at ${ARCHITECT_NODE_LIMIT} nodes. Remove a linear node before adding a decision block.`
          : selectedKind
          ? `${POLICY_BLOCK_META[selectedKind].label} selected. Choose a highlighted policy slot.`
          : "No block selected."}
      </p>
      {selectedKind && (
        <div className="architect-palette__fallback-slots" aria-label={`Compatible slots for ${POLICY_BLOCK_META[selectedKind].label}`}>
          <strong>Click / touch fallback</strong>
          {compatibleSlots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              className="architect-palette__fallback-slot is-selected-compatible"
              data-policy-slot-fallback={slot.id}
              data-edge-id={slot.edgeId}
              data-compatible-kinds={slot.compatibleKinds.join(" ")}
              aria-label={`Insert ${POLICY_BLOCK_META[selectedKind].label} between ${nodeLabels.get(slot.sourceNodeId)} and ${nodeLabels.get(slot.targetNodeId)}. ${slot.reason}`}
              disabled={capacityReached}
              onClick={() => onInsertPolicy(slot.edgeId, selectedKind)}
            >
              <span>{nodeLabels.get(slot.sourceNodeId)} → {nodeLabels.get(slot.targetNodeId)}</span>
              <small>{slot.reason}</small>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

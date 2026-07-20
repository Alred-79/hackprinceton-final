import { useLayoutEffect, useRef, useState } from "react";
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { POLICY_BLOCK_META, type PolicySlot } from "@/features/architect/policySlots";
import type { PolicyNodeKind } from "@/features/architect/types";

export interface ArchitectEdgeData extends Record<string, unknown> {
  status: "idle" | "active" | "traversed" | "skipped";
  progress: number;
  renderDot: boolean;
  previewVisible: boolean;
  slot?: PolicySlot;
  selectedPolicyKind: PolicyNodeKind | null;
  draggingPolicyKind: PolicyNodeKind | null;
  capacityReached: boolean;
  onInsertPolicy: (edgeId: string, kind: PolicyNodeKind) => void;
}

export type ArchitectFlowEdge = Edge<ArchitectEdgeData, "architectEdge">;

export default function ArchitectEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<ArchitectFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const status = data?.status ?? "idle";
  const progress = Math.max(0, Math.min(1, data?.progress ?? 0));
  const geometryRef = useRef<SVGPathElement>(null);
  const [dotPoint, setDotPoint] = useState({ x: sourceX, y: sourceY });
  useLayoutEffect(() => {
    const geometry = geometryRef.current;
    if (!data?.renderDot || !geometry?.getTotalLength || !geometry.getPointAtLength) return;
    const length = geometry.getTotalLength();
    const point = geometry.getPointAtLength(length * progress);
    setDotPoint({ x: point.x, y: point.y });
  }, [data?.renderDot, path, progress]);
  const statusContent = status === "active"
    ? { icon: "▶", label: "Active" }
    : status === "traversed"
      ? { icon: "✓", label: "Traversed" }
      : status === "skipped"
        ? { icon: "⊘", label: "Skipped" }
        : { icon: "○", label: "Pending" };
  const slot = data?.slot;
  const selectedKind = data?.selectedPolicyKind ?? null;
  const draggingKind = data?.draggingPolicyKind ?? null;
  const interactionKind = draggingKind ?? selectedKind;
  const slotCompatible = Boolean(slot && interactionKind && slot.compatibleKinds.includes(interactionKind));
  const compatibleLabels = slot?.compatibleKinds.map((kind) => POLICY_BLOCK_META[kind].shortLabel).join(", ") ?? "";
  const capacityReached = data?.capacityReached ?? false;
  const interactionClass = interactionKind
    ? slotCompatible
      ? ` is-compatible${selectedKind ? " is-selected-compatible" : ""}`
      : " is-incompatible"
    : "";
  const capacityReason = "Draft capacity reached; remove a linear node before filling a policy slot.";

  function insert(kind: PolicyNodeKind | null) {
    if (capacityReached || !slot || !kind || !slot.compatibleKinds.includes(kind)) return;
    data?.onInsertPolicy(slot.edgeId, kind);
  }

  return (
    <g className={`architect-edge architect-edge--${status}`} data-edge-id={id} data-status={status}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <path ref={geometryRef} className="architect-edge__geometry" d={path} fill="none" stroke="none" aria-hidden="true" />
      {slot && (
        <foreignObject
          className="architect-policy-slot-object"
          x={labelX - 22}
          y={labelY - 22}
          width="44"
          height="44"
        >
          <button
            type="button"
            className={`architect-policy-slot nodrag nopan nowheel${interactionClass}${capacityReached ? " is-capacity-disabled" : ""}`}
            data-policy-slot-id={slot.id}
            data-edge-id={slot.edgeId}
            data-compatible-kinds={slot.compatibleKinds.join(" ")}
            data-interaction-mode={draggingKind ? "drag" : selectedKind ? "selected" : "idle"}
            aria-label={capacityReached
              ? `Unavailable policy slot. ${capacityReason}`
              : `Open policy slot. ${slot.reason}. Compatible blocks: ${compatibleLabels}.${selectedKind ? ` Selected block: ${POLICY_BLOCK_META[selectedKind].label}.` : " Select a featured block first."}`}
            aria-disabled={capacityReached || Boolean(interactionKind && !slot.compatibleKinds.includes(interactionKind))}
            disabled={capacityReached}
            title={capacityReached ? capacityReason : `${slot.reason}. Compatible: ${compatibleLabels}`}
            onClick={() => insert(selectedKind)}
            onDragOver={(event) => {
              if (capacityReached || !draggingKind || !slot.compatibleKinds.includes(draggingKind)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const kind = event.dataTransfer.getData("application/x-architect-policy-block") as PolicyNodeKind;
              insert(kind);
            }}
          >
            <span className="architect-policy-slot__plus" aria-hidden="true">+</span>
            <span className="architect-policy-slot__details" aria-hidden="true">
              <strong>Add control</strong>
              <small>{compatibleLabels}</small>
            </span>
          </button>
        </foreignObject>
      )}
      {data?.previewVisible && (
        <g
          className="architect-edge__status"
          data-edge-status-label={statusContent.label}
          transform={`translate(${labelX - 34} ${labelY + (slot ? 30 : -10)})`}
          role="status"
          tabIndex={0}
          aria-label={`Edge ${id}: ${statusContent.label}`}
        >
          <rect width="68" height="20" rx="10" />
          <text x="34" y="13" textAnchor="middle">{statusContent.icon} {statusContent.label}</text>
        </g>
      )}
      {data?.renderDot && (
        <circle
          className="architect-edge__motion-dot"
          data-progress={progress.toFixed(3)}
          cx={dotPoint.x}
          cy={dotPoint.y}
          r={2}
          aria-hidden="true"
        />
      )}
    </g>
  );
}

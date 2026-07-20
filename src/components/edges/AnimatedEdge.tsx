import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { useAssuranceStore } from "@/store/assuranceStore";

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
}: EdgeProps) {
  const run = useAssuranceStore((state) => state.run);
  const traversals = run?.events.filter((event) => event.canvas_edge_id === id) ?? [];
  const traversed = traversals.length > 0;
  const rejectedRoute = traversals.some((event) => {
    const handle = String(event.payload?.source_handle ?? "");
    return /failure|error|rejected|failed/.test(handle);
  });
  const stroke = rejectedRoute
    ? "rgb(248 113 113)"
    : traversed
      ? "rgb(52 211 153)"
      : "hsl(var(--muted-foreground) / 0.4)";
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke,
          strokeWidth: traversed ? 3 : 2,
        }}
      />
      {/* Pulse dot traveling along the path */}
      <circle r="3" fill={traversed ? stroke : "hsl(var(--primary))"} opacity="0.9">
        <animateMotion dur="2.5s" repeatCount="indefinite" path={edgePath} />
      </circle>
      {/* Secondary fainter dot, offset */}
      <circle r="2" fill="hsl(var(--primary))" opacity="0.4">
        <animateMotion dur="2.5s" repeatCount="indefinite" path={edgePath} begin="1.25s" />
      </circle>
      {/* Glow trail on the edge */}
      <path
        d={edgePath}
        fill="none"
        stroke={traversed ? stroke : "hsl(var(--primary) / 0.15)"}
        opacity={traversed ? 0.25 : 1}
        strokeWidth="6"
        strokeLinecap="round"
      />
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);

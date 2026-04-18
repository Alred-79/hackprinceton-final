import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

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
          stroke: "hsl(var(--muted-foreground) / 0.4)",
          strokeWidth: 2,
        }}
      />
      {/* Pulse dot traveling along the path */}
      <circle r="3" fill="hsl(var(--primary))" opacity="0.9">
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
        stroke="hsl(var(--primary) / 0.15)"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);

import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Lock,
  AlertTriangle,
  Brain,
  CheckCircle,
  GitBranch,
  Globe,
  FileText,
  Filter,
  Database,
  Shield,
  LogIn,
  LogOut,
  Settings2,
} from "lucide-react";
import type { SimNodeType } from "@/types/simulator";
import { NODE_TYPE_META } from "@/data/nodeTypes";
import { getModelById } from "@/data/models";
import { useSimulatorStore } from "@/store/simulatorStore";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  LogIn, LogOut, Brain, CheckCircle, GitBranch, Globe, FileText, Filter, Database, Shield,
};

interface SimNodeData {
  simNodeType: SimNodeType;
  label: string;
  locked?: boolean;
  model?: string;
  routes?: string[];
  contextGateMode?: string;
  isDisconnected?: boolean;
  isRunning?: boolean;
  optimizationScore?: number;
}

type SimNodeProps = NodeProps & { data: SimNodeData };

// Node types that have configurable settings in the inspector
const EDITABLE_TYPES = new Set<SimNodeType>([
  "executor",
  "evaluator",
  "router",
  "context_gate",
  "tool_rag",
]);

function getModelScale(modelId?: string): number {
  if (!modelId) return 0.9;
  const model = getModelById(modelId);
  if (!model) return 0.9;
  switch (model.tier) {
    case "small": return 0.88;
    case "medium": return 1.0;
    case "large": return 1.18;
    case "xl": return 1.32;
    default: return 1.0;
  }
}

function getDepthShadow(modelId?: string): string {
  if (!modelId) return "0 2px 4px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)";
  const model = getModelById(modelId);
  if (!model) return "0 2px 4px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)";
  const cost = model.costPer1kTokens;
  if (cost <= 0.3) {
    return "0 2px 6px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)";
  } else if (cost <= 3.5) {
    return "0 4px 12px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08)";
  } else if (cost <= 12) {
    return "0 8px 20px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.1)";
  }
  return "0 12px 28px rgba(0,0,0,0.45), 0 6px 12px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)";
}

const GLOW_COLORS: Record<string, string> = {
  "node-input": "34, 197, 94",
  "node-output": "244, 63, 94",
  "node-executor": "59, 130, 246",
  "node-evaluator": "245, 158, 11",
  "node-router": "168, 85, 247",
  "node-tool": "6, 182, 212",
  "node-context": "249, 115, 22",
  "node-fallback": "239, 68, 68",
};

function SimulatorNodeComponent({ id, data, selected }: SimNodeProps) {
  const meta = NODE_TYPE_META[data.simNodeType];
  const Icon = ICON_MAP[meta.icon] || Brain;
  const isEditable = EDITABLE_TYPES.has(data.simNodeType) && !data.locked;

  const scale = useMemo(() => getModelScale(data.model), [data.model]);
  const depthShadow = useMemo(() => getDepthShadow(data.model), [data.model]);
  const glowRgb = GLOW_COLORS[meta.color] || "59, 130, 246";

  const optScore = data.optimizationScore ?? 0;
  const isRunning = data.isRunning ?? false;

  const colorClasses: Record<string, string> = {
    "node-input": "border-emerald-500/60 bg-emerald-950/60",
    "node-output": "border-rose-500/60 bg-rose-950/60",
    "node-executor": "border-blue-500/60 bg-blue-950/60",
    "node-evaluator": "border-amber-500/60 bg-amber-950/60",
    "node-router": "border-purple-500/60 bg-purple-950/60",
    "node-tool": "border-cyan-500/60 bg-cyan-950/60",
    "node-context": "border-orange-500/60 bg-orange-950/60",
    "node-fallback": "border-red-500/60 bg-red-950/60",
  };

  const iconColors: Record<string, string> = {
    "node-input": "text-emerald-400",
    "node-output": "text-rose-400",
    "node-executor": "text-blue-400",
    "node-evaluator": "text-amber-400",
    "node-router": "text-purple-400",
    "node-tool": "text-cyan-400",
    "node-context": "text-orange-400",
    "node-fallback": "text-red-400",
  };

  const showContextWarning = data.simNodeType === "context_gate" && !data.contextGateMode;

  const glowIntensity = isRunning ? 0.3 + optScore * 0.7 : 0;
  const glowSpread = isRunning ? 8 + optScore * 24 : 0;
  const glowShadow = isRunning
    ? `0 0 ${glowSpread}px rgba(${glowRgb}, ${glowIntensity}), 0 0 ${glowSpread * 2}px rgba(${glowRgb}, ${glowIntensity * 0.4})`
    : "";

  const combinedShadow = glowShadow
    ? `${depthShadow}, ${glowShadow}`
    : depthShadow;

  const tiltDeg = (scale - 0.88) * 4;

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    useSimulatorStore.getState().selectNode(id);
    useSimulatorStore.getState().setActiveRightTab("inspector");
  };

  return (
    <div
      className={cn(
        "relative rounded-xl border-2 transition-all duration-200 group",
        colorClasses[meta.color] || "border-border bg-card",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        isRunning && "sim-node-running"
      )}
      style={{
        transform: `scale(${scale}) perspective(600px) rotateX(${tiltDeg}deg)`,
        boxShadow: combinedShadow,
        minWidth: `${Math.round(140 * scale)}px`,
        padding: `${Math.round(10 * scale)}px ${Math.round(14 * scale)}px`,
        transformOrigin: "center center",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Top highlight bar (3D bevel effect) */}
      <div
        className="absolute inset-x-0 top-0 h-[1px] rounded-t-xl"
        style={{
          background: `linear-gradient(90deg, transparent, rgba(255,255,255,${0.08 + scale * 0.06}), transparent)`,
        }}
      />

      {/* Edit button — top-right, only for configurable nodes */}
      {isEditable && (
        <button
          onClick={handleEditClick}
          className={cn(
            "absolute -top-2 -right-2 z-10 rounded-full border-2 p-0.5",
            "bg-card border-border text-muted-foreground",
            "hover:text-foreground hover:border-primary hover:bg-primary/10",
            "opacity-0 group-hover:opacity-100 transition-all duration-150",
            "shadow-md hover:shadow-lg",
            selected && "opacity-100"
          )}
          style={{
            width: `${Math.round(20 * scale)}px`,
            height: `${Math.round(20 * scale)}px`,
          }}
          title="Edit node configuration"
        >
          <Settings2
            style={{
              width: `${Math.round(12 * scale)}px`,
              height: `${Math.round(12 * scale)}px`,
            }}
          />
        </button>
      )}

      {/* Input handles */}
      {data.simNodeType !== "input" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
        />
      )}

      {/* Node content */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "shrink-0 rounded-md flex items-center justify-center",
            isRunning && "animate-pulse"
          )}
          style={{
            width: `${Math.round(24 * scale)}px`,
            height: `${Math.round(24 * scale)}px`,
            background: isRunning
              ? `radial-gradient(circle, rgba(${glowRgb}, 0.3), transparent)`
              : undefined,
          }}
        >
          <Icon
            className={cn(iconColors[meta.color])}
            style={{
              width: `${Math.round(14 * scale)}px`,
              height: `${Math.round(14 * scale)}px`,
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="font-semibold text-foreground truncate leading-tight"
            style={{ fontSize: `${Math.round(12 * scale)}px` }}
          >
            {data.label}
          </div>
          {data.model && (
            <div
              className="text-muted-foreground truncate"
              style={{ fontSize: `${Math.round(9 * scale)}px`, marginTop: "1px" }}
            >
              {data.model}
            </div>
          )}
        </div>
        {data.locked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
        {data.isDisconnected && <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />}
        {showContextWarning && <AlertTriangle className="h-3 w-3 text-orange-400 shrink-0" />}
      </div>

      {/* Tier indicator bar at bottom */}
      {data.model && (
        <div
          className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
          style={{
            background: `rgba(${glowRgb}, ${0.15 + scale * 0.2})`,
          }}
        />
      )}

      {/* Output handles */}
      {data.simNodeType === "router" && data.routes ? (
        data.routes.map((route, i) => (
          <Handle
            key={`route-${i}`}
            type="source"
            position={Position.Right}
            id={`route-${i}`}
            style={{ top: `${((i + 1) / (data.routes!.length + 1)) * 100}%` }}
            className="!w-3 !h-3 !bg-purple-400 !border-2 !border-background"
          />
        ))
      ) : data.simNodeType === "fallback_router" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="success"
            style={{ top: "33%" }}
            className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-background"
          />
          <Handle
            type="source"
            position={Position.Right}
            id="failure"
            style={{ top: "66%" }}
            className="!w-3 !h-3 !bg-red-400 !border-2 !border-background"
          />
        </>
      ) : data.simNodeType === "evaluator" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="pass"
            style={{ top: "33%" }}
            className="!w-3 !h-3 !bg-emerald-400 !border-2 !border-background"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="fail"
            className="!w-3 !h-3 !bg-red-400 !border-2 !border-background"
          />
        </>
      ) : data.simNodeType !== "output" ? (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
        />
      ) : null}

      {/* Route labels */}
      {data.simNodeType === "router" && data.routes && (
        <div className="absolute -right-1 top-0 h-full flex flex-col justify-around pr-5">
          {data.routes.map((route, i) => (
            <span key={i} className="text-[8px] text-muted-foreground whitespace-nowrap">{route}</span>
          ))}
        </div>
      )}

      {/* Fallback labels */}
      {data.simNodeType === "fallback_router" && (
        <div className="absolute -right-1 top-0 h-full flex flex-col justify-around pr-5">
          <span className="text-[8px] text-emerald-400">Success</span>
          <span className="text-[8px] text-red-400">Failure</span>
        </div>
      )}
    </div>
  );
}

export const SimulatorNode = memo(SimulatorNodeComponent);

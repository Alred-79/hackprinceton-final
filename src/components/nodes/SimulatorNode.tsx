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
  Terminal,
  Webhook,
  UserCheck,
  Server,
  Radio,
  Braces,
  ShieldCheck,
  Info,
} from "lucide-react";
import type { SimNodeType } from "@/types/simulator";
import { NODE_TYPE_META } from "@/data/nodeTypes";
import { getModelById } from "@/data/models";
import { useSimulatorStore } from "@/store/simulatorStore";
import { cn } from "@/lib/utils";
import { useAssuranceStore } from "@/store/assuranceStore";
import { assuranceNodeVisualState } from "@/lib/assurancePresentation";

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  LogIn, LogOut, Brain, Braces, CheckCircle, GitBranch, Globe, FileText, Filter, Database, Shield, ShieldCheck, Terminal, Webhook, UserCheck, Server, Radio,
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
  costRatio?: number; // 0–1, 0 = cheapest, 1 = most expensive
  hasHandoffBrief?: boolean;
}

type SimNodeProps = NodeProps & { data: SimNodeData };

const EDITABLE_TYPES = new Set<SimNodeType>([
  "executor",
  "evaluator",
  "router",
  "context_gate",
  "tool_rag",
  "api_call",
  "human_review",
  "mcp_server",
  "typed_handoff_gate",
  "evidence_check",
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

/** Returns a visual elevation derived only from the selected model tier. */
function getElevation(modelId?: string): number {
  if (!modelId) return 1;
  const model = getModelById(modelId);
  if (!model) return 1;
  return { small: 1, medium: 2, large: 3, xl: 4 }[model.tier];
}

/** Yellow (cheap) → Orange → Red (expensive) based on cost ratio */
function getCostGlowColor(costRatio: number): string {
  // HSL hue: 50 (yellow) → 20 (orange) → 0 (red)
  const hue = Math.round(50 - costRatio * 50);
  const saturation = 80 + costRatio * 20;
  const lightness = 55 - costRatio * 10;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getCostGlowRGB(costRatio: number): string {
  // Yellow: 250,204,21 → Orange: 249,115,22 → Red: 239,68,68
  const r = Math.round(250 - costRatio * 11);
  const g = Math.round(204 - costRatio * 136);
  const b = Math.round(21 + costRatio * 47);
  return `${r}, ${g}, ${b}`;
}

const CATEGORY_COLORS: Record<string, string> = {
  "node-input": "34, 197, 94",
  "node-output": "244, 63, 94",
  "node-executor": "59, 130, 246",
  "node-evaluator": "245, 158, 11",
  "node-router": "168, 85, 247",
  "node-tool": "6, 182, 212",
  "node-context": "249, 115, 22",
  "node-fallback": "239, 68, 68",
  "node-human": "217, 119, 6",
  "node-mcp": "99, 102, 241",
  "node-stream": "16, 185, 129",
};

function SimulatorNodeComponent({ id, data, selected }: SimNodeProps) {
  const meta = NODE_TYPE_META[data.simNodeType];
  const simNode = useSimulatorStore((state) => state.nodes.find((node) => node.id === id));
  const assuranceEnabled = useAssuranceStore((state) => state.enabled);
  const assuranceRun = useAssuranceStore((state) => state.run);
  const assuranceCapabilities = useAssuranceStore((state) => state.capabilities);
  const Icon = ICON_MAP[meta.icon] || Brain;
  const isEditable = EDITABLE_TYPES.has(data.simNodeType) && !data.locked;
  const costRatio = data.costRatio ?? 0;
  const hasCost = !!data.model;

  const scale = useMemo(() => getModelScale(data.model), [data.model]);
  const elevation = useMemo(() => getElevation(data.model), [data.model]);
  const categoryRgb = CATEGORY_COLORS[meta.color] || "59, 130, 246";

  const isRunning = data.isRunning ?? false;
  const optScore = data.optimizationScore ?? 0;

  const colorClasses: Record<string, string> = {
    "node-input": "border-emerald-500/60 bg-emerald-950/60",
    "node-output": "border-rose-500/60 bg-rose-950/60",
    "node-executor": "border-blue-500/60 bg-blue-950/60",
    "node-evaluator": "border-amber-500/60 bg-amber-950/60",
    "node-router": "border-purple-500/60 bg-purple-950/60",
    "node-tool": "border-cyan-500/60 bg-cyan-950/60",
    "node-context": "border-orange-500/60 bg-orange-950/60",
    "node-fallback": "border-red-500/60 bg-red-950/60",
    "node-human": "border-yellow-600/60 bg-yellow-950/60",
    "node-mcp": "border-indigo-500/60 bg-indigo-950/60",
    "node-stream": "border-emerald-500/60 bg-emerald-950/60",
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
    "node-human": "text-yellow-500",
    "node-mcp": "text-indigo-400",
    "node-stream": "text-emerald-400",
  };

  const showContextWarning = data.simNodeType === "context_gate" && !data.contextGateMode;
  const assuranceEvents = assuranceRun?.events.filter((event) => event.canvas_node_id === id) ?? [];
  const assuranceVisualState = assuranceNodeVisualState(assuranceEvents, assuranceRun?.terminal_kind);
  const assuranceRecovered = assuranceVisualState === "recovered";
  const assuranceFailed = assuranceVisualState === "failed";
  const assurancePassed = assuranceVisualState === "passed";
  const executorAssured = data.simNodeType === "executor" && simNode?.config.executorAssurance?.enabled;
  const resolvedCapability = assuranceCapabilities?.operations.find((operation) =>
    operation.node_type === data.simNodeType &&
    operation.operation_id === simNode?.config.assuranceOperationId &&
    operation.operation_version === simNode?.config.assuranceOperationVersion
  );
  const registeredInputs = resolvedCapability?.ports?.filter((port) => port.direction === "input") ?? [];
  const registeredOutputs = resolvedCapability?.ports?.filter((port) => port.direction === "output") ?? [];

  // 3D shadows — elevation controls depth prominence
  const baseZ = elevation;
  const depthShadow = [
    `0 ${baseZ * 2}px ${baseZ * 4}px rgba(0,0,0,${0.2 + baseZ * 0.05})`,
    `0 ${baseZ}px ${baseZ * 2}px rgba(0,0,0,${0.15 + baseZ * 0.04})`,
    `0 ${baseZ * 0.5}px ${baseZ}px rgba(0,0,0,0.1)`,
    `inset 0 1px 0 rgba(255,255,255,${0.05 + baseZ * 0.02})`,
  ].join(", ");

  // Cost-based ambient glow (yellow → red)
  const costGlowRgb = getCostGlowRGB(costRatio);
  const costGlowIntensity = hasCost ? 0.15 + costRatio * 0.35 : 0;
  const costGlowSpread = hasCost ? 6 + costRatio * 18 : 0;
  const costGlowShadow = hasCost
    ? `0 0 ${costGlowSpread}px rgba(${costGlowRgb}, ${costGlowIntensity})`
    : "";

  // Runtime optimization glow
  const runGlowIntensity = isRunning ? 0.3 + optScore * 0.7 : 0;
  const runGlowSpread = isRunning ? 10 + optScore * 25 : 0;
  const runGlowShadow = isRunning
    ? `0 0 ${runGlowSpread}px rgba(${categoryRgb}, ${runGlowIntensity}), 0 0 ${runGlowSpread * 2}px rgba(${categoryRgb}, ${runGlowIntensity * 0.3})`
    : "";

  const combinedShadow = [depthShadow, costGlowShadow, runGlowShadow]
    .filter(Boolean)
    .join(", ");

  // 3D perspective tilt — higher elevation = slight tilt to show depth
  const tiltDeg = (elevation - 1) * 0.8;

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
        assurancePassed && "ring-2 ring-emerald-400/70",
        assuranceRecovered && "ring-2 ring-amber-400/80",
        assuranceFailed && "ring-2 ring-red-400/80",
        isRunning && "sim-node-running"
      )}
      style={{
        transform: `scale(${scale}) perspective(800px) rotateX(${tiltDeg}deg) translateZ(${baseZ * 2}px)`,
        boxShadow: combinedShadow,
        padding: `${Math.round(8 * scale)}px ${Math.round(12 * scale)}px`,
        transformOrigin: "center center",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Top highlight bar (3D bevel effect) */}
      <div
        className="absolute inset-x-0 top-0 h-[2px] rounded-t-xl"
        style={{
          background: `linear-gradient(90deg, transparent, rgba(255,255,255,${0.06 + elevation * 0.03}), transparent)`,
        }}
      />

      {/* Cost glow indicator ring - visible when node has a model */}
      {hasCost && costRatio > 0.1 && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            border: `1px solid ${getCostGlowColor(costRatio)}`,
            opacity: 0.2 + costRatio * 0.3,
          }}
        />
      )}

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
      {data.simNodeType !== "input" && (assuranceEnabled && registeredInputs.length ? registeredInputs : [{ id: undefined }]).map((port, index, items) => (
        <Handle
          key={port.id ?? "legacy-input"}
          type="target"
          position={Position.Left}
          id={data.simNodeType === "typed_handoff_gate" || data.simNodeType === "evidence_check" ? "in" : port.id}
          style={items.length > 1 ? { top: `${((index + 1) / (items.length + 1)) * 100}%` } : undefined}
          className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
        />
      ))}

      {/* Node content — single line, no truncation */}
      <div className="flex items-center gap-2 whitespace-nowrap">
        <div
          className={cn(
            "shrink-0 rounded-md flex items-center justify-center",
            isRunning && "animate-pulse"
          )}
          style={{
            width: `${Math.round(22 * scale)}px`,
            height: `${Math.round(22 * scale)}px`,
            background: isRunning
              ? `radial-gradient(circle, rgba(${categoryRgb}, 0.3), transparent)`
              : hasCost
              ? `radial-gradient(circle, rgba(${costGlowRgb}, 0.1), transparent)`
              : undefined,
          }}
        >
          <Icon
            className={cn(iconColors[meta.color])}
            style={{
              width: `${Math.round(13 * scale)}px`,
              height: `${Math.round(13 * scale)}px`,
            }}
          />
        </div>
        <span
          className="font-semibold text-foreground leading-tight"
          style={{ fontSize: `${Math.round(11 * scale)}px` }}
        >
          {data.label}
        </span>
        <span
          className="rounded border border-white/10 bg-black/20 px-1 py-0.5 text-[7px] uppercase tracking-wider text-muted-foreground"
          title={assuranceEnabled ? "This node participates only when explicitly bound and compiled." : "This canvas node is design-only. Execute mode uses registered runtime nodes."}
        >
          {assuranceEnabled
            ? (simNode?.config.assuranceOperationId || data.simNodeType === "typed_handoff_gate" || data.simNodeType === "evidence_check" ? "bound" : "unbound")
            : data.simNodeType === "typed_handoff_gate" || data.simNodeType === "evidence_check"
              ? "assurance off"
              : "design"}
        </span>
        {data.model && (
          <>
            <span className="text-muted-foreground/40">|</span>
            <span
              className="text-muted-foreground"
              style={{ fontSize: `${Math.round(9 * scale)}px` }}
            >
              {data.model}
            </span>
            {hasCost && (
              <div
                className="shrink-0 rounded-full"
                style={{
                  width: "5px",
                  height: "5px",
                  backgroundColor: getCostGlowColor(costRatio),
                  opacity: 0.8,
                }}
              />
            )}
          </>
        )}
        {data.locked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
        {data.isDisconnected && <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />}
        {showContextWarning && <AlertTriangle className="h-3 w-3 text-orange-400 shrink-0" />}
        {data.simNodeType === "tool_rag" && (
          <Info className="h-3 w-3 shrink-0 text-cyan-300/80" aria-label="Deterministic one-time stub" title="Deterministic one-time stub: BM25, token-hash vector, or hybrid retrieval over frozen teaching data. It is replayable and is not a production embedding service." />
        )}
        {data.hasHandoffBrief && (
          <FileText className="h-2.5 w-2.5 text-violet-400/70 shrink-0" title="Handoff brief defined" />
        )}
        {executorAssured && (
          <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1 py-0.5 text-[7px] text-cyan-200">
            {simNode?.config.executorAssurance?.contractId}
          </span>
        )}
        {data.simNodeType === "typed_handoff_gate" && simNode?.config.typedHandoffGate?.contractId && (
          <span className="rounded border border-orange-400/30 bg-orange-400/10 px-1 py-0.5 text-[7px] text-orange-200">
            TypeAdapter · {simNode.config.typedHandoffGate.contractId}
          </span>
        )}
        {data.simNodeType === "evidence_check" && (
          <span className="rounded border border-violet-400/30 bg-violet-400/10 px-1 py-0.5 text-[7px] text-violet-200">
            {simNode?.config.evidenceCheck?.checkIds.length ?? 0} checks
          </span>
        )}
        {assuranceRecovered && <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1 py-0.5 text-[7px] text-amber-200">recovered</span>}
      </div>

      {/* Bottom elevation bar — thicker = more 3D depth */}
      <div
        className="absolute inset-x-0 bottom-0 rounded-b-xl"
        style={{
          height: `${Math.max(2, elevation)}px`,
          background: hasCost
            ? `linear-gradient(90deg, transparent, rgba(${costGlowRgb}, ${0.2 + costRatio * 0.25}), transparent)`
            : `linear-gradient(90deg, transparent, rgba(${categoryRgb}, 0.15), transparent)`,
        }}
      />

      {/* Side depth bar (left) — simulates a 3D extrusion */}
      <div
        className="absolute left-0 inset-y-1 w-[2px] rounded-l-xl"
        style={{
          background: `linear-gradient(180deg, rgba(255,255,255,${0.05 + elevation * 0.015}), transparent, rgba(0,0,0,${0.1 + elevation * 0.03}))`,
        }}
      />

      {/* Output handles */}
      {data.simNodeType === "typed_handoff_gate" ? (
        <>
          <Handle type="source" position={Position.Right} id="pass" style={{ top: "33%" }} className="!h-3 !w-3 !border-2 !border-background !bg-emerald-400" />
          <Handle type="source" position={Position.Right} id="rejected" style={{ top: "66%" }} className="!h-3 !w-3 !border-2 !border-background !bg-red-400" />
        </>
      ) : data.simNodeType === "evidence_check" ? (
        <>
          <Handle type="source" position={Position.Right} id="pass" style={{ top: "33%" }} className="!h-3 !w-3 !border-2 !border-background !bg-emerald-400" />
          <Handle type="source" position={Position.Right} id="failed" style={{ top: "66%" }} className="!h-3 !w-3 !border-2 !border-background !bg-red-400" />
        </>
      ) : executorAssured ? (
        <>
          <Handle type="source" position={Position.Right} id="success" style={{ top: "33%" }} className="!h-3 !w-3 !border-2 !border-background !bg-emerald-400" />
          <Handle type="source" position={Position.Right} id="failure" style={{ top: "66%" }} className="!h-3 !w-3 !border-2 !border-background !bg-red-400" />
        </>
      ) : assuranceEnabled && registeredOutputs.length ? (
        <>
          {registeredOutputs.map((port, index) => (
            <Handle
              key={port.id}
              type="source"
              position={Position.Right}
              id={port.id}
              style={{ top: `${((index + 1) / (registeredOutputs.length + 1)) * 100}%` }}
              className={cn("!h-3 !w-3 !border-2 !border-background", /failure|error|rejected|failed/.test(port.id) ? "!bg-red-400" : "!bg-emerald-400")}
            />
          ))}
        </>
      ) : data.simNodeType === "router" && data.routes ? (
        data.routes.map((_, i) => (
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

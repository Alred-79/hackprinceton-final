import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Lock, AlertTriangle, Brain, CheckCircle, GitBranch, Globe, FileText, Filter, Database, Shield, LogIn, LogOut } from "lucide-react";
import type { SimNodeType } from "@/types/simulator";
import { NODE_TYPE_META } from "@/data/nodeTypes";
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
}

type SimNodeProps = NodeProps & { data: SimNodeData };

function SimulatorNodeComponent({ data, selected }: SimNodeProps) {
  const meta = NODE_TYPE_META[data.simNodeType];
  const Icon = ICON_MAP[meta.icon] || Brain;

  const colorClasses: Record<string, string> = {
    "node-input": "border-emerald-500/60 bg-emerald-500/10",
    "node-output": "border-rose-500/60 bg-rose-500/10",
    "node-executor": "border-blue-500/60 bg-blue-500/10",
    "node-evaluator": "border-amber-500/60 bg-amber-500/10",
    "node-router": "border-purple-500/60 bg-purple-500/10",
    "node-tool": "border-cyan-500/60 bg-cyan-500/10",
    "node-context": "border-orange-500/60 bg-orange-500/10",
    "node-fallback": "border-red-500/60 bg-red-500/10",
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

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 px-4 py-3 min-w-[160px] shadow-md transition-all",
        colorClasses[meta.color] || "border-border bg-card",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        "hover:shadow-lg"
      )}
    >
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
        <Icon className={cn("h-4 w-4 shrink-0", iconColors[meta.color])} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">{data.label}</div>
          {data.model && (
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">{data.model}</div>
          )}
        </div>
        {data.locked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
        {data.isDisconnected && <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />}
        {showContextWarning && <AlertTriangle className="h-3 w-3 text-orange-400 shrink-0" />}
      </div>

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

      {/* Route labels for Router */}
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

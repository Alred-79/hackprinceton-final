import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Brain,
  CheckCircle,
  GitBranch,
  Globe,
  FileText,
  Database,
  Terminal,
  Webhook,
  UserCheck,
  Server,
  ArrowDownToLine,
  ArrowUpFromLine,
  Filter,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Clock,
  Shield,
} from "lucide-react";

interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

interface NaiveMetrics {
  model: string;
  estimatedCost: number;
  estimatedLatency: number;
  estimatedReliability: number;
  whyItFails: string;
}

interface WorkflowData {
  summary: string;
  principlesApplied: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metrics: {
    estimatedCost: number;
    estimatedLatency: number;
    estimatedReliability: number;
  };
  naive: NaiveMetrics;
}

const typeIcons: Record<string, typeof Brain> = {
  executor: Brain,
  evaluator: CheckCircle,
  router: GitBranch,
  web_search: Globe,
  file_rw: FileText,
  tool_rag: Database,
  code_exec: Terminal,
  api_call: Webhook,
  human_review: UserCheck,
  mcp_server: Server,
  context_gate: Filter,
  fallback_router: ShieldAlert,
  input: ArrowDownToLine,
  output: ArrowUpFromLine,
};

const typeColors: Record<string, string> = {
  executor: "#8b5cf6",
  evaluator: "#22c55e",
  router: "#f59e0b",
  web_search: "#06b6d4",
  file_rw: "#06b6d4",
  tool_rag: "#06b6d4",
  code_exec: "#06b6d4",
  api_call: "#06b6d4",
  human_review: "#eab308",
  mcp_server: "#818cf8",
  context_gate: "#f97316",
  fallback_router: "#ef4444",
  input: "#6b7280",
  output: "#6b7280",
};

export default function WorkflowResult({ data }: { data: WorkflowData }) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const fNodes: Node[] = data.nodes.map((n) => {
      const Icon = typeIcons[n.type] || Brain;
      const color = typeColors[n.type] || "#6b7280";
      return {
        id: n.id,
        position: n.position,
        data: {
          label: (
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <Icon size={14} style={{ color }} />
              <span className="text-xs font-medium text-foreground whitespace-nowrap">
                {n.label}
              </span>
              {n.config?.model && (
                <span className="text-[10px] text-muted-foreground ml-1">
                  {String(n.config.model)}
                </span>
              )}
            </div>
          ),
        },
        style: {
          background: "hsl(224 24% 12%)",
          border: `1.5px solid ${color}40`,
          borderRadius: "8px",
          boxShadow: `0 2px 8px ${color}20`,
        },
      };
    });

    const fEdges: Edge[] = data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      style: { stroke: "hsl(220 12% 30%)", strokeWidth: 1.5 },
      animated: true,
    }));

    return { flowNodes: fNodes, flowEdges: fEdges };
  }, [data]);

  const costSaving = data.naive.estimatedCost > 0
    ? Math.round((1 - data.metrics.estimatedCost / data.naive.estimatedCost) * 100)
    : 0;
  const latencySaving = data.naive.estimatedLatency > 0
    ? Math.round((1 - data.metrics.estimatedLatency / data.naive.estimatedLatency) * 100)
    : 0;
  const reliabilityGain = data.metrics.estimatedReliability - data.naive.estimatedReliability;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
        <p className="text-sm text-foreground font-medium">{data.summary}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {data.principlesApplied.map((p, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* Before / After comparison */}
      <div className="grid grid-cols-2 gap-4">
        {/* Naive */}
        <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/20">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold text-destructive">Naive: Single {data.naive.model}</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <DollarSign className="h-3 w-3" /> Cost
              </span>
              <span className="text-destructive font-mono">${data.naive.estimatedCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" /> Latency
              </span>
              <span className="text-destructive font-mono">{data.naive.estimatedLatency.toFixed(1)}s</span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Shield className="h-3 w-3" /> Reliability
              </span>
              <span className="text-destructive font-mono">{data.naive.estimatedReliability}%</span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">{data.naive.whyItFails}</p>
        </div>

        {/* Optimized */}
        <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-emerald-400">Optimized: {data.nodes.length} Nodes</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <DollarSign className="h-3 w-3" /> Cost
              </span>
              <span className="text-emerald-400 font-mono">
                ${data.metrics.estimatedCost.toFixed(2)}
                <span className="text-emerald-500 ml-1">(-{costSaving}%)</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" /> Latency
              </span>
              <span className="text-emerald-400 font-mono">
                {data.metrics.estimatedLatency.toFixed(1)}s
                <span className="text-emerald-500 ml-1">(-{latencySaving}%)</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Shield className="h-3 w-3" /> Reliability
              </span>
              <span className="text-emerald-400 font-mono">
                {data.metrics.estimatedReliability}%
                <span className="text-emerald-500 ml-1">(+{reliabilityGain}%)</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Architecture graph */}
      <div className="rounded-lg border border-border overflow-hidden" style={{ height: 400 }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
        >
          <Background color="hsl(220 12% 18%)" gap={20} />
          <Controls
            showInteractive={false}
            className="!bg-card !border-border !rounded-lg"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Brain, Braces, CheckCircle2, CircleDashed, GitBranch, Shield, SkipForward, UserCheck } from "lucide-react";
import type { ArchitectNode as ArchitectNodeModel } from "@/features/architect/types";

export interface ArchitectNodeData extends Record<string, unknown> {
  model: ArchitectNodeModel;
  status: "idle" | "active" | "traversed" | "skipped";
  previewVisible: boolean;
}

export type ArchitectFlowNode = Node<ArchitectNodeData, "architectNode">;

function decisionSummary(model: ArchitectNodeModel): string | null {
  switch (model.config.type) {
    case "schema_gate":
      return `${model.config.mode} · ${model.config.requiredFields.length} ${model.config.requiredFields.length === 1 ? "field" : "fields"}`;
    case "context_gate":
      return `${model.config.tokenCap.toLocaleString()} symbolic units · ${model.config.strategy}`;
    case "human_review":
      return "optional checkpoint";
    case "evaluator":
      return "criterion configured";
    case "router":
      return "2 routes · named default";
    default:
      return null;
  }
}

const iconByKind = {
  input: ArrowDownToLine,
  output: ArrowUpFromLine,
  action: Brain,
  router: GitBranch,
  evaluator: CheckCircle2,
  human_review: UserCheck,
  schema_gate: Braces,
  context_gate: Shield,
};

export default function ArchitectNode({ data, selected }: NodeProps<ArchitectFlowNode>) {
  const { model, status, previewVisible } = data;
  const Icon = iconByKind[model.kind];
  const statusContent = status === "active"
    ? { Icon: Activity, label: "Active" }
    : status === "traversed"
      ? { Icon: CheckCircle2, label: "Traversed" }
      : status === "skipped"
        ? { Icon: SkipForward, label: "Skipped" }
        : { Icon: CircleDashed, label: "Pending" };
  const StatusIcon = statusContent.Icon;
  const decisionNode = ["router", "evaluator", "human_review", "schema_gate", "context_gate"].includes(model.kind);
  const summary = decisionSummary(model);
  return (
    <div
      className={`architect-node architect-node--${status}${selected ? " architect-node--selected" : ""}${decisionNode ? " architect-node--decision" : ""}`}
      data-node-id={model.id}
      data-status={status}
      data-decision-node={decisionNode ? "true" : "false"}
    >
      {model.kind !== "input" && <Handle type="target" position={Position.Left} id="in" />}
      <div className="architect-node__heading">
        <Icon aria-hidden="true" size={15} />
        <span>{model.label}</span>
      </div>
      <div className="architect-node__meta">
        <span>{model.kind.replace("_", " ")}</span>
        <div className="architect-node__badges">
          {model.config.type === "action" && previewVisible && (
            <span className="architect-simulated-marker">Simulated</span>
          )}
          {previewVisible && (
            <span className="architect-node-status" data-node-status-label={statusContent.label}>
              <StatusIcon size={11} aria-hidden="true" /> {statusContent.label}
            </span>
          )}
        </div>
      </div>
      {summary && <div className="architect-node__policy-summary" data-policy-summary={model.kind}>{summary}</div>}
      {model.config.type === "router" ? (
        <div className="architect-route-handles">
          {model.config.routes.map((route, index) => (
            <Handle
              key={route.id}
              type="source"
              position={Position.Right}
              id={route.id}
              title={`${route.label} (${route.role})`}
              style={{ top: `${38 + index * 28}%` }}
            />
          ))}
        </div>
      ) : model.kind !== "output" ? (
        <Handle type="source" position={Position.Right} id="next" />
      ) : null}
    </div>
  );
}

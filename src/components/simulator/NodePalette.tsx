import { NODE_TYPE_META } from "@/data/nodeTypes";
import { useSimulatorStore } from "@/store/simulatorStore";
import { Brain, CheckCircle, GitBranch, Globe, FileText, Filter, Database, Shield, GripVertical, Terminal, Webhook, UserCheck, Server } from "lucide-react";
import type { SimNodeType } from "@/types/simulator";
import { cn } from "@/lib/utils";
import { vibrateTap } from "@/lib/vibrate";

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Brain, CheckCircle, GitBranch, Globe, FileText, Filter, Database, Shield, Terminal, Webhook, UserCheck, Server,
};

const CATEGORY_LABELS: Record<string, string> = {
  brain: "Brain Nodes",
  tool: "Tool Nodes",
  control: "Control Nodes",
};

const CATEGORY_ORDER = ["brain", "tool", "control"];

const categoryAccents: Record<string, { dot: string; item: string }> = {
  brain: {
    dot: "bg-blue-400",
    item: "border-blue-500/30 hover:border-blue-500/60 bg-blue-500/5 hover:bg-blue-500/10",
  },
  tool: {
    dot: "bg-cyan-400",
    item: "border-cyan-500/30 hover:border-cyan-500/60 bg-cyan-500/5 hover:bg-cyan-500/10",
  },
  control: {
    dot: "bg-purple-400",
    item: "border-purple-500/30 hover:border-purple-500/60 bg-purple-500/5 hover:bg-purple-500/10",
  },
};

export function NodePalette() {
  const scenario = useSimulatorStore((s) => s.currentScenario);
  const addNode = useSimulatorStore((s) => s.addNode);
  const selectNode = useSimulatorStore((s) => s.selectNode);
  const nodes = useSimulatorStore((s) => s.nodes);
  const isEvaluating = useSimulatorStore((s) => s.isEvaluating);

  if (!scenario) return null;

  const available = scenario.availableNodeTypes.filter((t) => t !== "input" && t !== "output");

  // Group by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    types: available.filter((t) => NODE_TYPE_META[t].category === cat),
  })).filter((g) => g.types.length > 0);

  const handleAddNode = (type: SimNodeType) => {
    if (isEvaluating) return;
    const meta = NODE_TYPE_META[type];
    const id = `${type}-${Date.now()}`;
    const existingCount = nodes.filter((n) => n.type === type).length;

    addNode({
      id,
      type,
      config: { ...meta.defaultConfig, label: `${meta.label} ${existingCount + 1}` },
      position: { x: 300 + Math.random() * 200, y: 150 + Math.random() * 300 },
    });
    selectNode(id);
    vibrateTap();
  };

  const onDragStart = (e: React.DragEvent, type: SimNodeType) => {
    if (isEvaluating) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("application/simnode-type", type);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="space-y-3">
      {grouped.map((group) => {
        const accent = categoryAccents[group.category] || categoryAccents.brain;
        return (
          <div key={group.category}>
            <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
              <div className={cn("w-1.5 h-1.5 rounded-full", accent.dot)} />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {group.label}
              </span>
            </div>
            <div className="space-y-1">
              {group.types.map((type) => {
                const meta = NODE_TYPE_META[type];
                const Icon = ICON_MAP[meta.icon] || Brain;
                return (
                  <button
                    key={type}
                    disabled={isEvaluating}
                    draggable={!isEvaluating}
                    onClick={() => handleAddNode(type)}
                    onDragStart={(e) => onDragStart(e, type)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-lg border px-2 py-2 text-left",
                      "transition-all text-xs group",
                      accent.item,
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                      "cursor-grab active:cursor-grabbing",
                      "hover:shadow-sm"
                    )}
                  >
                    <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium text-foreground text-[11px]">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { NODE_TYPE_META } from "@/data/nodeTypes";
import { useSimulatorStore } from "@/store/simulatorStore";
import { Brain, CheckCircle, GitBranch, Globe, FileText, Filter, Database, Shield } from "lucide-react";
import type { SimNodeType } from "@/types/simulator";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Brain, CheckCircle, GitBranch, Globe, FileText, Filter, Database, Shield,
};

const categoryColors: Record<string, string> = {
  brain: "border-blue-500/40 hover:border-blue-500/70 bg-blue-500/5",
  tool: "border-cyan-500/40 hover:border-cyan-500/70 bg-cyan-500/5",
  control: "border-purple-500/40 hover:border-purple-500/70 bg-purple-500/5",
};

export function NodePalette() {
  const scenario = useSimulatorStore((s) => s.currentScenario);
  const addNode = useSimulatorStore((s) => s.addNode);
  const selectNode = useSimulatorStore((s) => s.selectNode);
  const nodes = useSimulatorStore((s) => s.nodes);
  const isEvaluating = useSimulatorStore((s) => s.isEvaluating);

  if (!scenario) return null;

  const available = scenario.availableNodeTypes.filter((t) => t !== "input" && t !== "output");

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
  };

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
        Add Nodes
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {available.map((type) => {
          const meta = NODE_TYPE_META[type];
          const Icon = ICON_MAP[meta.icon] || Brain;
          return (
            <button
              key={type}
              disabled={isEvaluating}
              onClick={() => handleAddNode(type)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-all text-xs",
                categoryColors[meta.category] || "border-border",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "cursor-pointer"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-medium text-foreground">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

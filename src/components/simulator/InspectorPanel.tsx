import { useSimulatorStore } from "@/store/simulatorStore";
import { NODE_TYPE_META } from "@/data/nodeTypes";
import { MODELS } from "@/data/models";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { ContextGateMode } from "@/types/simulator";

export function InspectorPanel() {
  const selectedNodeId = useSimulatorStore((s) => s.selectedNodeId);
  const nodes = useSimulatorStore((s) => s.nodes);
  const updateNodeConfig = useSimulatorStore((s) => s.updateNodeConfig);
  const removeNode = useSimulatorStore((s) => s.removeNode);
  const isEvaluating = useSimulatorStore((s) => s.isEvaluating);

  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4">
        Select a node to inspect its configuration
      </div>
    );
  }

  const meta = NODE_TYPE_META[node.type];

  const handleDelete = () => {
    if (node.locked) {
      toast.error("This node is locked and cannot be deleted");
      return;
    }
    removeNode(node.id);
  };

  const addRoute = () => {
    const routes = node.config.routes || [];
    updateNodeConfig(node.id, { routes: [...routes, `Route ${routes.length + 1}`] });
  };

  const removeRoute = (index: number) => {
    const routes = node.config.routes || [];
    updateNodeConfig(node.id, { routes: routes.filter((_, i) => i !== index) });
  };

  const updateRoute = (index: number, value: string) => {
    const routes = [...(node.config.routes || [])];
    routes[index] = value;
    updateNodeConfig(node.id, { routes });
  };

  return (
    <div className="space-y-4 p-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        {!node.locked && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            disabled={isEvaluating}
            className="h-7 w-7 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Label */}
      <div className="space-y-1.5">
        <Label className="text-xs">Label</Label>
        <Input
          value={node.config.label}
          onChange={(e) => updateNodeConfig(node.id, { label: e.target.value })}
          disabled={isEvaluating}
          className="h-8 text-sm"
        />
      </div>

      {/* Model selector */}
      {meta.hasModel && (
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          <Select
            value={node.config.model || "gpt-4o"}
            onValueChange={(v) => updateNodeConfig(node.id, { model: v })}
            disabled={isEvaluating}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span>{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ${m.costPer1kTokens}/1k | {m.avgLatency}s
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Prompts */}
      {node.type === "executor" && (
        <div className="space-y-1.5">
          <Label className="text-xs">System Prompt</Label>
          <Textarea
            value={node.config.systemPrompt || ""}
            onChange={(e) => updateNodeConfig(node.id, { systemPrompt: e.target.value })}
            disabled={isEvaluating}
            placeholder="Define this executor's role, behavior, and output format..."
            className="min-h-[120px] text-sm resize-y"
          />
        </div>
      )}

      {node.type === "evaluator" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Evaluation Prompt</Label>
            <Textarea
              value={node.config.evaluationPrompt || ""}
              onChange={(e) => updateNodeConfig(node.id, { evaluationPrompt: e.target.value })}
              disabled={isEvaluating}
              placeholder="What should this evaluator check for..."
              className="min-h-[80px] text-sm resize-y"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Pass/Fail Criteria</Label>
            <Textarea
              value={node.config.passFailCriteria || ""}
              onChange={(e) => updateNodeConfig(node.id, { passFailCriteria: e.target.value })}
              disabled={isEvaluating}
              placeholder="Concrete conditions for pass vs fail..."
              className="min-h-[80px] text-sm resize-y"
            />
          </div>
        </>
      )}

      {node.type === "router" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Routing Prompt</Label>
            <Textarea
              value={node.config.routingPrompt || ""}
              onChange={(e) => updateNodeConfig(node.id, { routingPrompt: e.target.value })}
              disabled={isEvaluating}
              placeholder="How should this router classify inputs..."
              className="min-h-[80px] text-sm resize-y"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Routes</Label>
            <div className="space-y-1">
              {(node.config.routes || []).map((route, i) => (
                <div key={i} className="flex items-center gap-1">
                  <Input
                    value={route}
                    onChange={(e) => updateRoute(i, e.target.value)}
                    disabled={isEvaluating}
                    className="h-7 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRoute(i)}
                    disabled={isEvaluating || (node.config.routes || []).length <= 2}
                    className="h-7 w-7 shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addRoute}
              disabled={isEvaluating}
              className="w-full h-7 text-xs mt-1"
            >
              <Plus className="h-3 w-3 mr-1" /> Add Route
            </Button>
          </div>
        </>
      )}

      {/* Context Gate config */}
      {node.type === "context_gate" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Mode</Label>
            <Select
              value={node.config.contextGateMode || ""}
              onValueChange={(v) => updateNodeConfig(node.id, { contextGateMode: v as ContextGateMode })}
              disabled={isEvaluating}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_reset">Full Reset</SelectItem>
                <SelectItem value="structured_sendoff">Structured Sendoff</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {node.config.contextGateMode === "structured_sendoff" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Handoff Brief</Label>
              <Textarea
                value={node.config.handoffBrief || ""}
                onChange={(e) => updateNodeConfig(node.id, { handoffBrief: e.target.value })}
                disabled={isEvaluating}
                placeholder="What information to pass through and what to exclude..."
                className="min-h-[80px] text-sm resize-y"
              />
            </div>
          )}
        </>
      )}

      {/* Tool RAG config */}
      {node.type === "tool_rag" && (
        <div className="space-y-1.5">
          <Label className="text-xs">K Value (top-k retrieval)</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={node.config.kValue || 5}
            onChange={(e) => updateNodeConfig(node.id, { kValue: parseInt(e.target.value) || 5 })}
            disabled={isEvaluating}
            className="h-8 text-sm"
          />
        </div>
      )}

      {/* Output Schema */}
      {(node.type === "executor" || node.type === "evaluator") && (
        <div className="space-y-1.5">
          <Label className="text-xs">Output Schema (JSON, optional)</Label>
          <Textarea
            value={node.config.outputSchema || ""}
            onChange={(e) => updateNodeConfig(node.id, { outputSchema: e.target.value })}
            disabled={isEvaluating}
            placeholder='{"type": "object", "properties": {...}}'
            className="min-h-[60px] text-sm resize-y font-mono"
          />
        </div>
      )}
    </div>
  );
}

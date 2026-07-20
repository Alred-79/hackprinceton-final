import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BindingOperationOption {
  value: string;
  label: string;
}

export interface BindingNodeRow {
  id: string;
  label: string;
  value: string;
  operations: BindingOperationOption[];
}

export interface BindingEdgeRow {
  id: string;
  source: string;
  target: string;
  sourcePorts: string[];
  targetPorts: string[];
  sourceHandle: string;
  targetHandle: string;
  hadSourceHandle: boolean;
  hadTargetHandle: boolean;
}

interface BindingGraphPatchDialogProps {
  baseHash: string | null;
  nodes: BindingNodeRow[];
  edges: BindingEdgeRow[];
  onOperationChange: (nodeId: string, value: string) => void;
  onEdgeHandleChange: (
    edgeId: string,
    direction: "source" | "target",
    value: string,
  ) => void;
  onCancel: () => void;
  onApply: () => void;
}

/**
 * The patch dialog intentionally uses native selects. A large canvas can render
 * dozens of selectors in this scrollable overlay; portal/ref composition in the
 * Radix Select implementation can enter a callback-ref update loop when one
 * controlled selector changes while a later portal is opening. Native controls
 * keep the interaction local and remain fully keyboard accessible.
 */
export function BindingGraphPatchDialog({
  baseHash,
  nodes,
  edges,
  onOperationChange,
  onEdgeHandleChange,
  onCancel,
  onApply,
}: BindingGraphPatchDialogProps) {
  const unresolvedEdges = edges.filter(
    (edge) =>
      !edge.sourceHandle ||
      !edge.targetHandle ||
      !edge.sourcePorts.includes(edge.sourceHandle) ||
      !edge.targetPorts.includes(edge.targetHandle),
  );
  const missingBindings = nodes.some((node) => !node.value);
  const unresolvedHandleSets = edges.filter(
    (edge) => !edge.hadSourceHandle || !edge.hadTargetHandle,
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="binding-dialog-title"
    >
      <div className="max-h-[85vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
            Explicit binding GraphPatch preview
          </p>
          <h3 id="binding-dialog-title" className="mt-1 text-sm font-semibold">
            Choose operations and resolve ports
          </h3>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            Labels never select runtime code. This preview is anchored to the exact semantic base hash and applies node bindings plus canonical edge handles in one undoable transaction.
          </p>
          {baseHash && (
            <code
              className="mt-2 block truncate rounded bg-background/50 px-2 py-1 text-[8px] text-muted-foreground"
              title={baseHash}
            >
              base_source_graph_hash {baseHash}
            </code>
          )}
        </div>

        <div className="space-y-2">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="rounded border border-border/30 bg-background/30 p-2"
            >
              <div className="mb-1.5 flex justify-between">
                <span className="text-[10px] font-medium">{node.label}</span>
                <code className="text-[8px] text-muted-foreground">{node.id}</code>
              </div>
              <select
                aria-label={`${node.label} operation`}
                value={node.value}
                onChange={(event) => onOperationChange(node.id, event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-[10px] text-foreground outline-none transition-colors focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
              >
                <option value="" disabled>
                  Select explicitly
                </option>
                {node.operations.map((operation) => (
                  <option key={operation.value} value={operation.value}>
                    {operation.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Edge port diff
          </p>
          {edges.map((edge) => {
            const valid =
              Boolean(edge.sourceHandle && edge.targetHandle) &&
              edge.sourcePorts.includes(edge.sourceHandle) &&
              edge.targetPorts.includes(edge.targetHandle);
            return (
              <div
                key={edge.id}
                className={cn(
                  "rounded border p-2",
                  valid
                    ? "border-border/30 bg-background/30"
                    : "border-amber-400/25 bg-amber-400/[0.04]",
                )}
              >
                <div className="mb-1 flex justify-between text-[9px]">
                  <code>{edge.id}</code>
                  <span className="text-muted-foreground">
                    {edge.source} → {edge.target}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label={`${edge.id} source handle`}
                    value={edge.sourceHandle}
                    onChange={(event) =>
                      onEdgeHandleChange(edge.id, "source", event.target.value)
                    }
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-[9px] text-foreground outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
                  >
                    <option value="" disabled>
                      Source handle required
                    </option>
                    {edge.sourcePorts.map((port) => (
                      <option key={port} value={port}>
                        out: {port}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`${edge.id} target handle`}
                    value={edge.targetHandle}
                    onChange={(event) =>
                      onEdgeHandleChange(edge.id, "target", event.target.value)
                    }
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-[9px] text-foreground outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
                  >
                    <option value="" disabled>
                      Target handle required
                    </option>
                    {edge.targetPorts.map((port) => (
                      <option key={port} value={port}>
                        in: {port}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded border border-cyan-400/15 bg-cyan-400/[0.03] p-2 text-[9px] text-muted-foreground">
          Preview: update {nodes.length} node binding(s), resolve {unresolvedHandleSets} edge handle set(s), preserve all node IDs, positions, labels, and unrelated config.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onApply}
            disabled={missingBindings || unresolvedEdges.length > 0}
          >
            Apply binding patch
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Braces, CheckCircle2, GitCommitHorizontal, Loader2, Play, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BindingGraphPatchDialog } from "@/components/simulator/BindingGraphPatchDialog";
import { cn } from "@/lib/utils";
import { AssuranceApiError, assuranceApi, defaultAssuranceInput } from "@/lib/assuranceApi";
import {
  applyBindingGraphPatch,
  assertBindingGraphPatchBase,
  type BindingGraphPatch,
} from "@/lib/assuranceBindingPatch";
import { semanticGraphHash, semanticGraphIdentity, serializeSimulatorGraph } from "@/lib/assuranceGraph";
import { buildAssuranceStarterPair, type AssuranceStarterProfile } from "@/lib/assuranceStarters";
import { useAssuranceStore } from "@/store/assuranceStore";
import { useSimulatorStore } from "@/store/simulatorStore";
import type { AssuranceArtifact, AssuranceIssue } from "@/types/assurance";

export function AssuranceControls() {
  const [exitOpen, setExitOpen] = useState(false);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [bindingEdgeHandles, setBindingEdgeHandles] = useState<Record<string, { source?: string; target?: string }>>({});
  const [bindingBaseHash, setBindingBaseHash] = useState<string | null>(null);
  const simulator = useSimulatorStore();
  const assurance = useAssuranceStore();

  if (!assurance.available) return null;

  const starter = simulator.currentScenario && assurance.capabilities
    ? buildAssuranceStarterPair(simulator.currentScenario.id, assurance.capabilities)
    : null;

  const enter = () => {
    if (!starter) return;
    assurance.enter({
      nodes: structuredClone(simulator.nodes),
      edges: structuredClone(simulator.edges),
      historyIndex: simulator.historyIndex,
    });
    simulator.applyGraphPatch(starter.assured.nodes, starter.assured.edges);
  };

  const switchProfile = (profile: AssuranceStarterProfile) => {
    if (!starter || assurance.profile === profile) return;
    const graph = starter[profile];
    simulator.applyGraphPatch(graph.nodes, graph.edges);
    assurance.setProfile(profile);
    toast.success(profile === "assured" ? "Assured starter applied" : "Executable baseline applied", {
      description: profile === "assured"
        ? "Pydantic enforcement, the typed boundary, and independent checks are on the canvas."
        : "The same registered operations now run without the assurance mechanisms for direct comparison.",
    });
  };

  const compile = async (): Promise<AssuranceArtifact | null> => {
    if (!simulator.currentScenario) return null;
    try {
      assurance.setBusy("compile");
      assurance.setError(null);
      const graph = serializeSimulatorGraph(simulator.nodes, simulator.edges);
      const identity = semanticGraphIdentity(simulator.nodes, simulator.edges, assurance.capabilities);
      const response = await assuranceApi.compile(simulator.currentScenario.id, graph, assurance.maxOuterRevisions);
      const warnings = response.warnings.map((item) => normalizeIssue({ ...item }));
      const issues = response.issues.map((item) => normalizeIssue({ ...item }));
      assurance.setCompiled(response, identity, issues, warnings);
      toast.success("Current canvas compiled", { description: `Candidate ${response.candidate_hash.slice(0, 12)}…` });
      return response;
    } catch (error) {
      if (error instanceof AssuranceApiError && (error.status === undefined || error.status === 404)) {
        assurance.setCapabilities(null);
        return null;
      }
      const detail = error instanceof AssuranceApiError ? error.detail : null;
      const rawIssues = Array.isArray(detail)
        ? detail
        : detail && typeof detail === "object" && "issues" in detail
          ? (detail as { issues: Array<Record<string, unknown>> }).issues
          : [];
      assurance.setCompileFailed(
        error instanceof Error ? error.message : "Compile failed",
        rawIssues.map(normalizeIssue),
      );
      toast.error("Assurance compile failed", { description: error instanceof Error ? error.message : undefined });
      return null;
    }
  };

  const run = async (artifact: AssuranceArtifact) => {
    if (!simulator.currentScenario) return;
    try {
      assurance.setBusy("run");
      assurance.setError(null);
      const result = await assuranceApi.run(
        artifact,
        defaultAssuranceInput(simulator.currentScenario.id, assurance.fixtureMode),
      );
      assurance.setRun(result);
      simulator.setActiveRightTab("results");
      simulator.setActiveResultsTab("execution");
      toast[result.terminal_kind === "clean" || result.terminal_kind === "recovered" ? "success" : "error"](
        result.terminal_kind === "recovered" ? "Run recovered" : `Run ${result.terminal_kind.replaceAll("_", " ")}`,
      );
    } catch (error) {
      if (error instanceof AssuranceApiError && error.status === undefined) {
        assurance.setCapabilities(null);
        return;
      }
      assurance.setError(error instanceof Error ? error.message : "Run failed");
    }
  };

  const execute = async () => {
    const currentArtifact = assurance.artifact && assurance.status !== "stale"
      ? assurance.artifact
      : await compile();
    if (currentArtifact) await run(currentArtifact);
  };

  if (!assurance.enabled) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-cyan-400/20 bg-gradient-to-r from-cyan-400/[0.06] to-violet-400/[0.04] px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-300" />
          <div><p className="text-xs font-semibold text-foreground">Assurance Workbench</p><p className="text-[9px] text-muted-foreground">Compile this canvas into a real typed runtime; Evals stay outside the graph.</p></div>
        </div>
        <Button size="sm" variant="outline" onClick={enter} disabled={!starter} className="h-7 border-cyan-400/30 text-[10px] text-cyan-200 hover:bg-cyan-400/10">Apply assured starter</Button>
      </div>
    );
  }

  const unbound = simulator.nodes.filter((node) =>
    node.type !== "typed_handoff_gate" &&
    node.type !== "evidence_check" &&
    !node.config.assuranceOperationId
  );
  const bindable = unbound.filter((node) => assurance.capabilities?.operations.some((operation) => operation.node_type === node.type));
  const openBindings = async () => {
    const initial: Record<string, string> = {};
    for (const node of bindable) {
      const options = assurance.capabilities?.operations.filter((operation) => operation.node_type === node.type) ?? [];
      if (options.length === 1) initial[node.id] = `${options[0].operation_id}@${options[0].operation_version}`;
    }
    setBindings(initial);
    setBindingEdgeHandles(Object.fromEntries(simulator.edges.map((edge) => [edge.id, { source: edge.sourceHandle, target: edge.targetHandle }])));
    setBindingBaseHash(await semanticGraphHash(simulator.nodes, simulator.edges, assurance.capabilities));
    setBindingOpen(true);
  };
  const operationForNode = (node: typeof simulator.nodes[number]) => {
    const value = bindings[node.id];
    if (value) return assurance.capabilities?.operations.find((item) => `${item.operation_id}@${item.operation_version}` === value && item.node_type === node.type);
    return assurance.capabilities?.operations.find((item) => item.operation_id === node.config.assuranceOperationId && item.operation_version === node.config.assuranceOperationVersion && item.node_type === node.type);
  };
  const portsForNode = (node: typeof simulator.nodes[number] | undefined, direction: "input" | "output") => {
    if (!node) return [];
    if (node.type === "typed_handoff_gate") return direction === "input" ? ["in"] : ["pass", "rejected"];
    if (node.type === "evidence_check") return direction === "input" ? ["in"] : ["pass", "failed"];
    return operationForNode(node)?.ports?.filter((port) => port.direction === direction).map((port) => port.id) ?? [];
  };
  const edgePreviews = simulator.edges.map((edge) => {
    const sourcePorts = portsForNode(simulator.nodes.find((node) => node.id === edge.source), "output");
    const targetPorts = portsForNode(simulator.nodes.find((node) => node.id === edge.target), "input");
    const selected = bindingEdgeHandles[edge.id] ?? {};
    return {
      edge,
      sourcePorts,
      targetPorts,
      sourceHandle: selected.source ?? edge.sourceHandle ?? (sourcePorts.length === 1 ? sourcePorts[0] : undefined),
      targetHandle: selected.target ?? edge.targetHandle ?? (targetPorts.length === 1 ? targetPorts[0] : undefined),
    };
  });
  const applyBindings = async () => {
    if (!assurance.capabilities || !bindingBaseHash) return;
    const current = useSimulatorStore.getState();
    const currentBaseHash = await semanticGraphHash(
      current.nodes,
      current.edges,
      assurance.capabilities,
    );
    try {
      const patch: BindingGraphPatch = {
        schema_version: "assurance.graph_patch.v1",
        patch_id: crypto.randomUUID(),
        base_source_graph_hash: bindingBaseHash,
        node_operations: bindable.map((node) => {
          const value = bindings[node.id];
          const operation = assurance.capabilities!.operations.find(
            (item) =>
              `${item.operation_id}@${item.operation_version}` === value &&
              item.node_type === node.type,
          );
          if (!operation) throw new Error(`Node ${node.id} has no explicit operation binding.`);
          return {
            op: "bind_operation" as const,
            node_id: node.id,
            expected_node_type: node.type,
            operation_id: operation.operation_id,
            operation_version: operation.operation_version,
            replacement_config: {
              ...(operation.default_config ?? {}),
              label: node.config.label,
              assuranceOperationId: operation.operation_id,
              assuranceOperationVersion: operation.operation_version,
            },
          };
        }),
        edge_operations: edgePreviews.map((preview) => {
          if (!preview.sourceHandle || !preview.targetHandle) {
            throw new Error(`Edge ${preview.edge.id} has unresolved handles.`);
          }
          return {
            op: "set_edge_handles" as const,
            edge_id: preview.edge.id,
            source_handle: preview.sourceHandle,
            target_handle: preview.targetHandle,
          };
        }),
      };
      assertBindingGraphPatchBase(patch, currentBaseHash);
      const next = applyBindingGraphPatch(current.nodes, current.edges, patch);
      current.applyGraphPatch(next.nodes, next.edges);
      setBindingOpen(false);
    } catch (error) {
      const stale = currentBaseHash !== bindingBaseHash;
      toast.error(stale ? "Binding preview is stale" : "Binding patch rejected", {
        description: error instanceof Error ? error.message : "The GraphPatch was invalid.",
      });
      if (stale) setBindingOpen(false);
    }
  };
  return (
    <>
      <div className="rounded-lg border border-cyan-400/25 bg-gradient-to-r from-card/70 to-cyan-950/20 px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-300" />
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-cyan-200">Assurance Workbench</p><p className="text-[9px] text-muted-foreground">Canvas graph is authoritative</p></div>
          </div>
          <StatusPill status={assurance.status} busy={assurance.busy} />
          {assurance.artifact && <code className="max-w-36 truncate text-[9px] text-muted-foreground" title={assurance.artifact.candidate_hash}>candidate {assurance.artifact.candidate_hash.slice(0, 12)}…</code>}
          <div className="h-6 w-px bg-border/40" />
          <div className="flex rounded-md border border-border/50 bg-background/50 p-0.5" aria-label="Assurance comparison profile">
            {(["baseline", "assured"] as const).map((profile) => (
              <button
                key={profile}
                type="button"
                onClick={() => switchProfile(profile)}
                aria-pressed={assurance.profile === profile}
                className={cn(
                  "rounded px-2 py-1 text-[9px] font-medium capitalize transition-colors",
                  assurance.profile === profile
                    ? profile === "assured" ? "bg-cyan-400/15 text-cyan-200" : "bg-amber-400/15 text-amber-200"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {profile}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="outer-revisions" className="whitespace-nowrap text-[9px] text-muted-foreground">Outer revisions</Label>
            <Input id="outer-revisions" aria-label="Outer revision budget" type="number" min={0} max={3} value={assurance.maxOuterRevisions} onChange={(event) => assurance.setMaxOuterRevisions(Number(event.target.value))} className="h-7 w-12 px-2 text-[10px]" />
          </div>
          <Select value={assurance.fixtureMode} onValueChange={(value) => assurance.setFixtureMode(value as "clean" | "invalid_output" | "handoff_drift" | "evidence_failure")}>
            <SelectTrigger className="h-7 w-36 text-[9px]" aria-label="Causal fixture"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="clean">Clean fixture</SelectItem><SelectItem value="invalid_output">Malformed output</SelectItem>{starter?.mechanisms.includes("Pydantic TypeAdapter handoff") && <SelectItem value="handoff_drift">Post-agent handoff drift</SelectItem>}<SelectItem value="evidence_failure">Schema-valid falsehood</SelectItem></SelectContent>
          </Select>
          <div className="flex-1" />
          {bindable.length > 0 && <Button size="sm" variant="outline" onClick={() => void openBindings()} className="h-7 border-amber-400/25 text-[10px] text-amber-200">Bind {bindable.length} nodes</Button>}
          <Button size="sm" variant="outline" onClick={() => void compile()} disabled={Boolean(assurance.busy)} className="h-7 gap-1 text-[10px]"><GitCommitHorizontal className="h-3 w-3" />{assurance.busy === "compile" ? "Compiling…" : "Compile"}</Button>
          <Button size="sm" onClick={() => void execute()} disabled={Boolean(assurance.busy)} className="h-7 gap-1 text-[10px]"><Play className="h-3 w-3" />{assurance.busy === "run" ? "Running…" : assurance.busy === "compile" ? "Compiling…" : `Run ${assurance.profile}`}</Button>
          <Button size="icon" variant="ghost" title="Exit assurance" onClick={() => setExitOpen(true)} className="h-7 w-7"><X className="h-3.5 w-3.5" /></Button>
        </div>
        {starter && <div className="mt-2 flex items-start gap-2 rounded border border-cyan-400/10 bg-background/25 px-2 py-1.5"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-cyan-300" /><div><p className="text-[9px] font-medium text-foreground">{starter.title}</p><p className="text-[8px] leading-4 text-muted-foreground">{starter.lesson}</p><p className="mt-0.5 text-[8px] text-cyan-200/80">{assurance.profile === "assured" ? starter.mechanisms.join(" · ") : "Executable control: same registered operations, assurance mechanisms removed."}</p></div></div>}
        {assurance.status === "stale" && <p className="mt-1.5 flex items-center gap-1 text-[9px] text-amber-300"><TriangleAlert className="h-3 w-3" />Semantic canvas changes made this candidate stale. Recompile before Run or Evals.</p>}
        {assurance.error && <p className="mt-1.5 rounded border border-red-400/20 bg-red-400/5 px-2 py-1 text-[9px] text-red-200">{assurance.error}</p>}
        {(assurance.issues.length > 0 || assurance.warnings.length > 0) && <div className="mt-1.5 space-y-1"><div className="flex gap-2 text-[9px]"><span className="text-red-300">{assurance.issues.length} compile errors</span><span className="text-amber-300">{assurance.warnings.length} warnings</span></div>{assurance.issues.slice(0, 3).map((issue) => <button key={`${issue.code}-${issue.canvas_node_id ?? issue.canvas_edge_id}`} onClick={() => issue.canvas_node_id && simulator.selectNode(issue.canvas_node_id)} className="block max-w-full truncate text-left text-[8px] text-red-200 hover:underline"><span className="font-mono">{issue.code}</span> · {issue.canvas_node_id ?? issue.canvas_edge_id ?? "graph"} · {issue.message}</button>)}</div>}
      </div>
      {exitOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"><div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-2xl"><div><h3 className="text-sm font-semibold">Exit Assurance Workbench?</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Both choices clear compiled artifacts, evidence overlays, and run/eval selection. Neither silently replaces your graph.</p></div><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => { assurance.exitKeep(); setExitOpen(false); }}>Keep canvas draft</Button><Button variant="destructive" onClick={() => { const snapshot = assurance.exitRevert(); if (snapshot) simulator.restoreGraphSnapshot(snapshot.nodes, snapshot.edges); setExitOpen(false); }}>Revert assurance edits</Button></div><Button variant="ghost" size="sm" className="w-full" onClick={() => setExitOpen(false)}>Cancel</Button></div></div>}
      {bindingOpen && (
        <BindingGraphPatchDialog
          baseHash={bindingBaseHash}
          nodes={bindable.map((node) => ({
            id: node.id,
            label: node.config.label,
            value: bindings[node.id] ?? "",
            operations: (assurance.capabilities?.operations ?? [])
              .filter((operation) => operation.node_type === node.type)
              .map((operation) => ({
                value: `${operation.operation_id}@${operation.operation_version}`,
                label: `${operation.label} · v${operation.operation_version}`,
              })),
          }))}
          edges={edgePreviews.map(({ edge, sourcePorts, targetPorts, sourceHandle, targetHandle }) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourcePorts,
            targetPorts,
            sourceHandle: sourceHandle ?? "",
            targetHandle: targetHandle ?? "",
            hadSourceHandle: Boolean(edge.sourceHandle),
            hadTargetHandle: Boolean(edge.targetHandle),
          }))}
          onOperationChange={(nodeId, value) =>
            setBindings((current) => ({ ...current, [nodeId]: value }))
          }
          onEdgeHandleChange={(edgeId, direction, value) =>
            setBindingEdgeHandles((current) => ({
              ...current,
              [edgeId]: { ...current[edgeId], [direction]: value },
            }))
          }
          onCancel={() => setBindingOpen(false)}
          onApply={() => void applyBindings()}
        />
      )}
    </>
  );
}

function normalizeIssue(value: Record<string, unknown>): AssuranceIssue {
  return {
    code: String(value.code ?? "ASSURANCE_ISSUE"),
    message: String(value.message ?? "Unknown compile issue"),
    canvas_node_id: (value.canvas_node_id ?? value.node_id) as string | undefined,
    canvas_edge_id: (value.canvas_edge_id ?? value.edge_id) as string | undefined,
    field_path: value.field_path as string | undefined,
  };
}

function StatusPill({ status, busy }: { status: ReturnType<typeof useAssuranceStore.getState>["status"]; busy: ReturnType<typeof useAssuranceStore.getState>["busy"] }) {
  const label = busy ? `${busy}…` : status;
  return <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider", status === "stale" ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : status === "failed" ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200")}>{busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : status === "passed" || status === "checked" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Braces className="h-2.5 w-2.5" />}{label}</span>;
}

import { useMemo } from "react";
import { useSimulatorStore } from "@/store/simulatorStore";
import { NODE_TYPE_META } from "@/data/nodeTypes";
import { MODELS } from "@/data/models";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Braces, Database, Info, ShieldCheck, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { ContextGateMode, HumanReviewType, KnowledgeRetrievalMode, ServedToolType } from "@/types/simulator";
import { useAssuranceStore } from "@/store/assuranceStore";
import { cn } from "@/lib/utils";
import { withEvidenceAggregation } from "@/lib/assurancePresentation";

export function InspectorPanel() {
  const selectedNodeId = useSimulatorStore((s) => s.selectedNodeId);
  const nodes = useSimulatorStore((s) => s.nodes);
  const updateNodeConfig = useSimulatorStore((s) => s.updateNodeConfig);
  const replaceNodeConfig = useSimulatorStore((s) => s.replaceNodeConfig);
  const removeNode = useSimulatorStore((s) => s.removeNode);
  const isEvaluating = useSimulatorStore((s) => s.isEvaluating);
  const assuranceEnabled = useAssuranceStore((s) => s.enabled);
  const capabilities = useAssuranceStore((s) => s.capabilities);

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

      {assuranceEnabled && capabilities && (
        <AssuranceNodeInspector
          node={node}
          capabilities={capabilities}
          disabled={isEvaluating}
          updateConfig={(config) => updateNodeConfig(node.id, config)}
          replaceConfig={(config) => replaceNodeConfig(node.id, config)}
        />
      )}

      {/* Model selector */}
      {meta.hasModel && !assuranceEnabled && (
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
                      ${m.inputPricePerMillion}–${m.outputPricePerMillion}/M · assumed {m.assumedLatencySeconds}s
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Prompts */}
      {node.type === "executor" && !assuranceEnabled && (
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

      {node.type === "evaluator" && !assuranceEnabled && (
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

      {node.type === "router" && !assuranceEnabled && (
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
      {node.type === "context_gate" && !assuranceEnabled && (
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
                <SelectItem value="pass_through">Pass Through</SelectItem>
                <SelectItem value="full_reset">Full Reset</SelectItem>
                <SelectItem value="structured_sendoff">Structured Sendoff</SelectItem>
                <SelectItem value="compact">Compact (design estimate)</SelectItem>
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

      {/* Knowledge Retrieval config (tool_rag is the backward-compatible wire ID). */}
      {node.type === "tool_rag" && !assuranceEnabled && (
        <KnowledgeRetrievalConfig node={node} disabled={isEvaluating} updateConfig={(config) => updateNodeConfig(node.id, config)} />
      )}

      {/* API Call config */}
      {node.type === "api_call" && !assuranceEnabled && (
        <div className="space-y-1.5">
          <Label className="text-xs">Endpoint Label</Label>
          <Input
            value={node.config.endpoint || ""}
            onChange={(e) => updateNodeConfig(node.id, { endpoint: e.target.value })}
            disabled={isEvaluating}
            placeholder='e.g. "Stripe API", "Slack Webhook"'
            className="h-8 text-sm"
          />
        </div>
      )}

      {/* Human Review config */}
      {node.type === "human_review" && !assuranceEnabled && (
        <div className="space-y-1.5">
          <Label className="text-xs">Review Type</Label>
          <Select
            value={node.config.reviewType || "approval"}
            onValueChange={(v) => updateNodeConfig(node.id, { reviewType: v as HumanReviewType })}
            disabled={isEvaluating}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approval">Approval (sign-off before proceeding)</SelectItem>
              <SelectItem value="edit">Edit (human revises the output)</SelectItem>
              <SelectItem value="escalation">Escalation (route to human specialist)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Human wait is not estimated without an explicit runtime measurement or user assumption.
          </p>
        </div>
      )}

      {/* MCP Server config */}
      {node.type === "mcp_server" && !assuranceEnabled && (
        <div className="space-y-1.5">
          <Label className="text-xs">Served Tools</Label>
          <p className="text-[10px] text-muted-foreground mb-1">
            Select which schemas this design node exposes. Tool count receives no automatic quality bonus.
          </p>
          {(["web_search", "file_rw", "tool_rag", "code_exec", "api_call"] as ServedToolType[]).map((tool) => {
            const served = node.config.servedTools || [];
            const isChecked = served.includes(tool);
            const toolLabels: Record<string, string> = {
              web_search: "Web Search",
              file_rw: "File R/W",
              tool_rag: "Knowledge Retrieval",
              code_exec: "Code Exec",
              api_call: "API Call",
            };
            return (
              <label key={tool} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isEvaluating}
                  onChange={() => {
                    const next = isChecked
                      ? served.filter((t) => t !== tool)
                      : [...served, tool];
                    updateNodeConfig(node.id, { servedTools: next as ServedToolType[] });
                  }}
                  className="rounded border-border"
                />
                <span className="text-foreground">{toolLabels[tool]}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssuranceNodeInspector({
  node,
  capabilities,
  disabled,
  updateConfig,
  replaceConfig,
}: {
  node: ReturnType<typeof useSimulatorStore.getState>["nodes"][number];
  capabilities: NonNullable<ReturnType<typeof useAssuranceStore.getState>["capabilities"]>;
  disabled: boolean;
  updateConfig: (config: Partial<typeof node.config>) => void;
  replaceConfig: (config: typeof node.config) => void;
}) {
  const issues = useAssuranceStore((state) => state.issues);
  const warnings = useAssuranceStore((state) => state.warnings);
  const nodeIssues = useMemo(
    () => [...issues, ...warnings].filter((issue) => issue.canvas_node_id === node.id),
    [issues, warnings, node.id],
  );
  const operations = capabilities.operations.filter((operation) => operation.node_type === node.type);
  const selectedOperation = node.config.assuranceOperationId && node.config.assuranceOperationVersion
    ? `${node.config.assuranceOperationId}@${node.config.assuranceOperationVersion}`
    : "";
  const selectedCapability = operations.find((operation) => `${operation.operation_id}@${operation.operation_version}` === selectedOperation);

  const issueList = nodeIssues.length > 0 ? <div className="space-y-1">{nodeIssues.map((issue) => <p key={`${issue.code}-${issue.message}`} className="rounded border border-amber-400/20 bg-amber-400/5 px-2 py-1 text-[9px] leading-4 text-amber-200"><span className="font-mono">{issue.code}</span> · {issue.message}</p>)}</div> : null;

  if (node.type === "typed_handoff_gate") {
    const config = node.config.typedHandoffGate;
    return (
      <div className="space-y-3 rounded-lg border border-orange-400/25 bg-orange-400/[0.04] p-3">
        <MechanismTitle icon={<Braces className="h-3.5 w-3.5" />} title="Pydantic TypeAdapter" subtitle="Validates this boundary; it does not repair or fact-check." />
        {issueList}
        <div className="space-y-1.5">
          <Label className="text-xs">Registered handoff contract</Label>
          <AssuranceNativeSelect aria-label="Registered handoff contract" value={config?.contractId || ""} onChange={(contractId) => {
            const contract = capabilities.handoff_contracts.find((item) => item.contract_id === contractId);
            if (!contract) return;
            updateConfig({ typedHandoffGate: { ...config!, contractId, contractVersion: contract.contract_version } });
          }} disabled={disabled} placeholder="Choose a contract" options={capabilities.handoff_contracts.map((contract) => ({ value: contract.contract_id, label: `${contract.label} · v${contract.contract_version}` }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Validation</Label>
            <AssuranceNativeSelect aria-label="Handoff validation method" value={config?.validationMethod || "validate_python"} onChange={(validationMethod) => updateConfig({ typedHandoffGate: { ...config!, validationMethod: validationMethod as "validate_python" | "validate_json" } })} disabled={disabled} options={[{ value: "validate_python", label: "validate_python" }, { value: "validate_json", label: "validate_json" }]} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">On rejection</Label>
            <AssuranceNativeSelect aria-label="Handoff rejection behavior" value={config?.rejectBehavior || "route"} onChange={(rejectBehavior) => updateConfig({ typedHandoffGate: { ...config!, rejectBehavior: rejectBehavior as "route" | "stop" | "request_revision" } })} disabled={disabled} options={[{ value: "route", label: "Failure route" }, { value: "stop", label: "Stop" }, { value: "request_revision", label: "Request revision" }]} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={config?.strict ?? true} onChange={(event) => updateConfig({ typedHandoffGate: { ...config!, strict: event.target.checked } })} disabled={disabled} /> Strict validation</label>
        <p className="text-[10px] leading-4 text-muted-foreground">Pass and rejected are real canvas ports. Request revision consumes the graph-level outer revision budget.</p>
      </div>
    );
  }

  if (node.type === "evidence_check") {
    const config = node.config.evidenceCheck;
    return (
      <div className="space-y-3 rounded-lg border border-violet-400/25 bg-violet-400/[0.04] p-3">
        <MechanismTitle icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Independent Evidence Check" subtitle="Tests grounding, policy, or scope independently of Pydantic." />
        {issueList}
        <div className="space-y-2">
          {capabilities.evidence_checks.map((check) => {
            const checked = config?.checkIds.includes(check.check_id) ?? false;
            return <label key={check.check_id} className="block rounded border border-border/30 bg-card/50 p-2 text-xs">
              <span className="flex items-start gap-2"><input className="mt-0.5" type="checkbox" checked={checked} disabled={disabled} onChange={() => { const checkWeights = { ...(config?.checkWeights ?? {}) }; if (checked) delete checkWeights[check.check_id]; else if (config?.aggregation === "weighted") checkWeights[check.check_id] = "1"; updateConfig({ evidenceCheck: { ...config!, checkIds: checked ? config!.checkIds.filter((id) => id !== check.check_id) : [...(config?.checkIds ?? []), check.check_id], checkWeights } }); }} /><span><span className="font-medium text-foreground">{check.label}</span><span className="mt-0.5 block text-[9px] text-muted-foreground">{check.engine ?? "registered"} · {check.method ?? "deterministic"}</span></span></span>
            </label>;
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label className="text-xs">Aggregation</Label><AssuranceNativeSelect aria-label="Evidence aggregation" value={config?.aggregation || "all"} onChange={(value) => updateConfig({ evidenceCheck: withEvidenceAggregation(config!, value as "all" | "any" | "weighted") })} disabled={disabled} options={[{ value: "all", label: "All must pass" }, { value: "any", label: "Any may pass" }, { value: "weighted", label: "Weighted score" }]} /></div>
          <div className="space-y-1.5"><Label className="text-xs">On failure</Label><AssuranceNativeSelect aria-label="Evidence failure behavior" value={config?.failureBehavior || "route"} onChange={(failureBehavior) => updateConfig({ evidenceCheck: { ...config!, failureBehavior: failureBehavior as "route" | "stop" } })} disabled={disabled} options={[{ value: "route", label: "Failure route" }, { value: "stop", label: "Stop" }]} /></div>
        </div>
        {config?.aggregation === "weighted" && <div className="space-y-2 rounded border border-violet-400/15 bg-background/30 p-2"><p className="text-[9px] leading-4 text-muted-foreground">Weights are explicit canonical decimals. Every selected check needs one positive weight; the runtime uses Decimal arithmetic, never floats.</p>{config.checkIds.map((checkId) => <div key={checkId} className="grid grid-cols-[1fr_5rem] items-center gap-2"><Label className="truncate text-[9px]" title={checkId}>{capabilities.evidence_checks.find((item) => item.check_id === checkId)?.label ?? checkId}</Label><Input aria-label={`Weight for ${checkId}`} value={config.checkWeights[checkId] ?? "1"} onChange={(event) => updateConfig({ evidenceCheck: { ...config, checkWeights: { ...config.checkWeights, [checkId]: event.target.value } } })} className="h-7 text-[10px]" /></div>)}<div className="space-y-1"><Label className="text-[9px]">Passing score [0, 1]</Label><Input value={config.passingScore ?? "0.7"} onChange={(event) => updateConfig({ evidenceCheck: { ...config, passingScore: event.target.value } })} className="h-7 text-[10px]" /></div></div>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.035] p-3">
      <div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Runtime operation</p><p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">The ID—not this node's label—selects registered behavior.</p></div><Badge variant="outline" className={selectedOperation ? "border-emerald-400/30 text-emerald-300" : "border-amber-400/30 text-amber-300"}>{selectedOperation ? "Bound" : "Unbound"}</Badge></div>
      {issueList}
      <AssuranceNativeSelect aria-label={`${node.config.label} runtime operation`} value={selectedOperation} onChange={(value) => {
        const operation = operations.find((item) => `${item.operation_id}@${item.operation_version}` === value);
        if (!operation) return;
        replaceConfig({
          ...(operation.default_config ?? {}),
          label: node.config.label,
          assuranceOperationId: operation.operation_id,
          assuranceOperationVersion: operation.operation_version,
        });
      }} disabled={disabled || operations.length === 0} placeholder={operations.length ? "Choose registered operation" : "Unsupported node type"} options={operations.map((operation) => ({ value: `${operation.operation_id}@${operation.operation_version}`, label: `${operation.label} · v${operation.operation_version}` }))} />
      {selectedCapability?.ports?.length ? <div><p className="mb-1 text-[9px] font-medium text-muted-foreground">Exact compiled ports</p><div className="flex flex-wrap gap-1">{selectedCapability.ports.map((port) => <span key={`${port.direction}-${port.id}`} className={cn("rounded border px-1.5 py-0.5 font-mono text-[8px]", port.direction === "input" ? "border-blue-400/20 text-blue-200" : /failure|error|rejected|failed/.test(port.id) ? "border-red-400/20 text-red-200" : "border-emerald-400/20 text-emerald-200")}>{port.direction === "input" ? "←" : "→"} {port.id}</span>)}</div></div> : null}
      {selectedCapability && <div className="space-y-1 rounded border border-border/20 bg-background/30 p-2 text-[8px] text-muted-foreground"><p><span className="text-foreground/70">role</span> {selectedCapability.operation_role ?? "registered operation"}</p>{selectedCapability.produced_payload_contracts?.length ? <p><span className="text-foreground/70">produces</span> {selectedCapability.produced_payload_contracts.map((item) => `${item.contract_id}@${item.contract_version}`).join(", ")}</p> : null}{selectedCapability.config_constraints && <p className="truncate" title={JSON.stringify(selectedCapability.config_constraints)}><span className="text-foreground/70">constraints</span> {JSON.stringify(selectedCapability.config_constraints)}</p>}</div>}
      {node.type === "tool_rag" && <KnowledgeRetrievalConfig node={node} disabled={disabled} updateConfig={updateConfig} />}
      {node.type === "executor" && <ExecutorEnforcement node={node} capabilities={capabilities} disabled={disabled} updateConfig={updateConfig} />}
    </div>
  );
}

function KnowledgeRetrievalConfig({ node, disabled, updateConfig }: { node: ReturnType<typeof useSimulatorStore.getState>["nodes"][number]; disabled: boolean; updateConfig: (config: Partial<typeof node.config>) => void }) {
  const mode = node.config.retrievalMode ?? "hybrid";
  return <div className="space-y-3 rounded-lg border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.07] via-cyan-400/[0.025] to-transparent p-3">
    <div className="flex items-start justify-between gap-3"><div className="flex gap-2"><span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 p-1.5 text-cyan-300"><Database className="h-3.5 w-3.5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">Knowledge Retrieval</p><p className="mt-0.5 text-[9px] leading-4 text-muted-foreground">Frozen corpus · deterministic one-run fixture</p></div></div><span title="Runs inspectable retrieval over a frozen scenario corpus. Vector mode uses stable token-hash vectors, not a production embedding provider. RAGAS-aligned metrics use fixture relevance IDs." className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.08] p-1 text-cyan-300"><Info className="h-3 w-3" /></span></div>
    <div className="grid grid-cols-[1fr_5rem] gap-2"><div className="space-y-1.5"><Label className="text-[10px]">Retrieval strategy</Label><AssuranceNativeSelect aria-label="Knowledge retrieval strategy" value={mode} onChange={(retrievalMode) => updateConfig({ retrievalMode: retrievalMode as KnowledgeRetrievalMode })} disabled={disabled} options={[{ value: "bm25", label: "BM25 · lexical" }, { value: "vector", label: "Vector · token hash" }, { value: "hybrid", label: "Hybrid · fused" }]} /></div><div className="space-y-1.5"><Label className="text-[10px]">Top-k</Label><Input aria-label="Knowledge retrieval top k" type="number" min={1} max={20} value={node.config.kValue ?? 5} onChange={(event) => updateConfig({ kValue: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} disabled={disabled} className="h-8 text-xs" /></div></div>
    <div className="grid grid-cols-2 gap-1">{[
      ["Context precision", "Rank-aware relevance of returned chunks."],
      ["Context recall", "Relevant fixture chunks successfully retrieved."],
      ["Context relevance", "Normalized retrieval-score signal."],
      ["Faithfulness", "Measured only after an answer exists."],
    ].map(([label, help]) => <div key={label} title={help} className="rounded border border-border/25 bg-background/35 px-2 py-1.5"><p className="text-[8px] font-medium text-foreground">{label}</p><p className="mt-0.5 text-[7px] text-muted-foreground">{label === "Faithfulness" ? "Not at retrieval stage" : "Recorded after run"}</p></div>)}</div>
    <p className="text-[8px] leading-3.5 text-muted-foreground"><span className="text-cyan-200">RAGAS-aligned deterministic metrics</span> use frozen relevance labels so comparisons are repeatable. They are not LLM-judge scores or production retrieval benchmarks.</p>
  </div>;
}

function schemaTypeLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "value";
  const schema = value as Record<string, unknown>;
  if (typeof schema.$ref === "string") return schema.$ref.split("/").at(-1) ?? "object";
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" | ");
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(schemaTypeLabel).join(" | ");
  if (schema.type === "array") return `list<${schemaTypeLabel(schema.items)}>`;
  return typeof schema.type === "string" ? schema.type : "object";
}

function schemaFields(schema: Record<string, unknown> | undefined) {
  if (!schema || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  return Object.entries(schema.properties as Record<string, unknown>).map(([name, value]) => ({
    name,
    type: schemaTypeLabel(value),
    required: required.has(name),
  }));
}

function ExecutorEnforcement({ node, capabilities, disabled, updateConfig }: { node: ReturnType<typeof useSimulatorStore.getState>["nodes"][number]; capabilities: NonNullable<ReturnType<typeof useAssuranceStore.getState>["capabilities"]>; disabled: boolean; updateConfig: (config: Partial<typeof node.config>) => void }) {
  const config = node.config.executorAssurance;
  const enabled = config?.enabled ?? false;
  const operation = capabilities.operations.find((item) => item.node_type === "executor" && item.operation_id === node.config.assuranceOperationId && item.operation_version === node.config.assuranceOperationVersion);
  const contracts = [...capabilities.output_contracts, ...capabilities.handoff_contracts].filter((contract) => operation?.allowed_executor_contracts?.some((allowed) => allowed.contract_id === contract.contract_id && allowed.contract_version === contract.contract_version));
  const first = contracts[0];
  const selectedAllowance = operation?.allowed_executor_contracts?.find((item) => item.contract_id === (config?.contractId ?? first?.contract_id));
  const outputModes = selectedAllowance?.supported_output_modes ?? [];
  const selectedContract = contracts.find((item) => item.contract_id === (config?.contractId ?? first?.contract_id) && item.contract_version === (config?.contractVersion ?? first?.contract_version));
  const fields = schemaFields(selectedContract?.json_schema);
  const isHandoff = selectedContract ? capabilities.handoff_contracts.some((item) => item.contract_id === selectedContract.contract_id && item.contract_version === selectedContract.contract_version) : false;

  return <div className="space-y-3 border-t border-cyan-400/15 pt-3">
    <div className="overflow-hidden rounded-lg border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.07] via-cyan-400/[0.025] to-transparent">
      <div className="flex items-start justify-between gap-3 border-b border-cyan-400/15 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 rounded-md border border-cyan-400/20 bg-cyan-400/10 p-1.5 text-cyan-300"><Braces className="h-3.5 w-3.5" /></span>
          <span><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">Output Contract</span><span className="mt-0.5 block text-[9px] leading-4 text-muted-foreground">One Pydantic model controls structure, validation, and repair.</span></span>
        </div>
        <Badge variant="outline" className={cn("shrink-0 text-[8px]", enabled ? "border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300" : "border-border/40 text-muted-foreground")}>{enabled ? "Pydantic enforced" : "Unstructured"}</Badge>
      </div>
      <div className="space-y-3 p-3">
        <label className="flex items-center justify-between gap-3 text-xs"><span><span className="font-medium text-foreground">Enforce typed output</span><span className="block text-[9px] leading-4 text-muted-foreground">Pydantic AI validates inside this executor and may retry malformed output.</span></span><input aria-label="Enable Pydantic AI output enforcement" type="checkbox" checked={enabled} disabled={disabled || !first} onChange={(event) => updateConfig({ executorAssurance: config ? { ...config, enabled: event.target.checked } : { enabled: event.target.checked, contractId: first?.contract_id ?? "", contractVersion: first?.contract_version ?? "1.0.0", strict: true, outputMode: operation?.allowed_executor_contracts?.find((item) => item.contract_id === first?.contract_id && item.contract_version === first?.contract_version)?.supported_output_modes[0] ?? "tool", validationRetries: 0 } })} /></label>
        {enabled && <>
          <div className="space-y-1.5"><Label className="text-[10px]">Registered Pydantic contract</Label><AssuranceNativeSelect aria-label="Executor output contract" value={config?.contractId ?? first?.contract_id ?? ""} onChange={(contractId) => { const contract = contracts.find((item) => item.contract_id === contractId); const allowed = operation?.allowed_executor_contracts?.find((item) => item.contract_id === contractId && item.contract_version === contract?.contract_version); if (contract && config) updateConfig({ executorAssurance: { ...config, contractId, contractVersion: contract.contract_version, outputMode: allowed?.supported_output_modes.includes(config.outputMode) ? config.outputMode : allowed?.supported_output_modes[0] ?? "tool" } }); }} disabled={disabled} options={contracts.map((contract) => ({ value: contract.contract_id, label: `${contract.label} · v${contract.contract_version}${capabilities.handoff_contracts.some((item) => item.contract_id === contract.contract_id && item.contract_version === contract.contract_version) ? " · handoff" : " · terminal"}` }))} /></div>
          {selectedContract && <div className="rounded-md border border-cyan-400/15 bg-background/35 p-2.5">
            <div className="flex items-center justify-between gap-2"><div><p className="font-mono text-[10px] text-cyan-100">{selectedContract.contract_id}@{selectedContract.contract_version}</p><p className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground">{isHandoff ? "Agent handoff" : "Terminal output"} · registered model</p></div>{selectedContract.json_schema_digest && <span className="font-mono text-[8px] text-muted-foreground" title={selectedContract.json_schema_digest}>sha256:{selectedContract.json_schema_digest.slice(0, 10)}…</span>}</div>
            {fields.length > 0 && <div className="mt-2 grid grid-cols-2 gap-1">{fields.map((field) => <div key={field.name} className="min-w-0 rounded border border-border/25 bg-card/40 px-2 py-1"><p className="truncate font-mono text-[8px] text-foreground" title={field.name}>{field.name}{field.required && <span className="ml-0.5 text-cyan-300">*</span>}</p><p className="truncate text-[7px] text-muted-foreground" title={field.type}>{field.type}</p></div>)}</div>}
            <p className="mt-2 text-[8px] leading-3.5 text-muted-foreground">The Pydantic model is authoritative. Its JSON Schema projection is generated automatically and cannot be edited independently.</p>
            {selectedContract.json_schema && <details className="mt-2 rounded border border-border/25 bg-black/15"><summary className="cursor-pointer px-2 py-1.5 text-[8px] font-medium text-muted-foreground hover:text-foreground">Advanced · generated JSON Schema</summary><pre className="max-h-52 overflow-auto border-t border-border/20 p-2 font-mono text-[7px] leading-3 text-cyan-100/75">{JSON.stringify(selectedContract.json_schema, null, 2)}</pre></details>}
          </div>}
          <div className="grid grid-cols-2 gap-2"><div><Label className="text-[10px]">Output mode</Label><AssuranceNativeSelect aria-label="Executor output mode" className="mt-1" value={config?.outputMode ?? outputModes[0] ?? "tool"} onChange={(outputMode) => config && updateConfig({ executorAssurance: { ...config, outputMode: outputMode as "tool" | "native" | "prompted" } })} disabled={disabled} options={outputModes.map((mode) => ({ value: mode, label: mode === "tool" ? "ToolOutput" : mode === "native" ? "NativeOutput" : "PromptedOutput" }))} /></div><div><Label className="text-[10px]">Validation retries</Label><Input aria-label="Executor validation retries" type="number" min={0} max={3} className="mt-1 h-8 text-xs" value={config?.validationRetries ?? 0} onChange={(event) => config && updateConfig({ executorAssurance: { ...config, validationRetries: Math.max(0, Math.min(3, Number(event.target.value))) } })} disabled={disabled} /></div></div>
          <label className="flex items-center gap-2 text-[9px] text-muted-foreground"><input type="checkbox" checked={config?.strict ?? true} onChange={(event) => config && updateConfig({ executorAssurance: { ...config, strict: event.target.checked } })} disabled={disabled} /><span>Strict validation · no coercion or extra fields</span></label>
          {config?.outputMode === "prompted" && <p className="text-[9px] leading-4 text-amber-200">PromptedOutput validates into the Pydantic model but does not provide provider-native strict schema enforcement.</p>}
        </>}
      </div>
    </div>
  </div>;
}

function AssuranceNativeSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  className,
  ...selectProps
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
} & Pick<React.SelectHTMLAttributes<HTMLSelectElement>, "aria-label">) {
  return (
    <select
      {...selectProps}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={cn(
        "h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function MechanismTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="flex gap-2"><span className="mt-0.5 text-primary">{icon}</span><div><p className="text-xs font-semibold text-foreground">{title}</p><p className="text-[9px] leading-4 text-muted-foreground">{subtitle}</p></div></div>;
}

import { useSimulatorStore } from "@/store/simulatorStore";
import { useRuntimeStore } from "@/store/runtimeStore";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  BarChart3,
  Beaker,
  CheckCircle,
  CircleDashed,
  Code2,
  Loader2,
  PlayCircle,
  ServerOff,
  XCircle,
  Braces,
  Database,
  GitBranch,
  Info,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ResultsTab } from "@/types/simulator";
import type { RuntimeConnectionStatus, RuntimeScenarioDefinition } from "@/types/runtime";
import { ExecutePanel } from "@/pages/runtime/ExecutePanel";
import { EvalPanel } from "@/pages/runtime/EvalPanel";
import { useAssuranceStore } from "@/store/assuranceStore";
import { assuranceApi, defaultAssuranceInput } from "@/lib/assuranceApi";
import { Button } from "@/components/ui/button";
import type { AssuranceEvent } from "@/types/assurance";

export function ResultsPanel({
  connectionStatus,
  executable,
  runtimeDefinition,
}: {
  connectionStatus: RuntimeConnectionStatus;
  executable: boolean;
  runtimeDefinition: RuntimeScenarioDefinition | null;
}) {
  const scenario = useSimulatorStore((state) => state.currentScenario);
  const activeTab = useSimulatorStore((state) => state.activeResultsTab);
  const setActiveTab = useSimulatorStore((state) => state.setActiveResultsTab);
  const setExpandedView = useRuntimeStore((state) => state.setExpandedView);
  const assuranceEnabled = useAssuranceStore((state) => state.enabled);

  if (!scenario) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-border/30 p-2">
        <ResultModeTab active={activeTab === "analysis"} onClick={() => setActiveTab("analysis")} icon={<BarChart3 />}>
          Analysis
        </ResultModeTab>
        <ResultModeTab active={activeTab === "execution"} onClick={() => setActiveTab("execution")} icon={<PlayCircle />}>
          Run
        </ResultModeTab>
        <ResultModeTab active={activeTab === "evals"} onClick={() => setActiveTab("evals")} icon={<Beaker />}>
          Evals
        </ResultModeTab>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {activeTab === "analysis" && <AnalysisResults />}
          {activeTab === "execution" && assuranceEnabled && <AssuranceExecutionResults />}
          {activeTab === "evals" && assuranceEnabled && <AssuranceEvalResults />}
          {activeTab !== "analysis" && !assuranceEnabled && !executable && <DesignOnlyRuntime />}
          {activeTab !== "analysis" && !assuranceEnabled && executable && connectionStatus === "checking" && <CheckingRuntime />}
          {activeTab !== "analysis" && !assuranceEnabled && executable && connectionStatus === "offline" && <OfflineRuntime />}
          {activeTab === "execution" && !assuranceEnabled && executable && connectionStatus === "online" && (
            <ExecutePanel
              scenarioId={scenario.id}
              disabled={false}
              compact
              runtimeDefinition={runtimeDefinition}
              onExpand={() => setExpandedView("execution")}
            />
          )}
          {activeTab === "evals" && !assuranceEnabled && executable && connectionStatus === "online" && (
            <EvalPanel
              scenarioId={scenario.id}
              disabled={false}
              compact
              onExpand={() => setExpandedView("evals")}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function AssuranceExecutionResults() {
  const artifact = useAssuranceStore((state) => state.artifact);
  const run = useAssuranceStore((state) => state.run);
  const status = useAssuranceStore((state) => state.status);
  const fixtureMode = useAssuranceStore((state) => state.fixtureMode);
  const issues = useAssuranceStore((state) => state.issues);
  const warnings = useAssuranceStore((state) => state.warnings);
  const scenario = useSimulatorStore((state) => state.currentScenario);

  if (!artifact) return <EmptyAssurance title="Compile the current graph" description="Run executes only an immutable candidate whose semantic hash matches this canvas." />;
  if (!run) return <div className="space-y-3"><EmptyAssurance title={status === "stale" ? "Candidate is stale" : "Candidate compiled"} description={status === "stale" ? "A semantic node, edge, port, contract, or check changed. Recompile before running." : `Candidate ${artifact.candidate_hash.slice(0, 16)}… is ready. Use Run compiled in the toolbar.`} />{scenario && status !== "stale" && <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.035] p-3"><p className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">Causal fixture lab · {fixtureMode.replaceAll("_", " ")}</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">This deterministic input goes through the compiled canvas—not a narrated mock. Change a retry, contract, gate, check, or edge; recompile; then compare persisted events.</p><pre className="mt-2 max-h-32 overflow-auto rounded bg-background/60 p-2 text-[8px] leading-4 text-foreground">{JSON.stringify(defaultAssuranceInput(scenario.id, fixtureMode), null, 2)}</pre></div>}</div>;

  const executorEvents = run.events.filter((event) => event.event_type.startsWith("executor_"));
  const handoffEvents = run.events.filter((event) => event.event_type.startsWith("handoff_"));
  const evidenceEvents = run.events.filter((event) => event.event_type.startsWith("evidence_"));
  const retrievalEvents = run.events.filter((event) => event.event_type === "knowledge_retrieval_completed");
  const mutationEvents = run.events.filter((event) => event.event_type === "fixture_mutation_applied");
  return <div className="space-y-4">
    <div className={cn("rounded-lg border p-3", run.terminal_kind === "clean" ? "border-emerald-400/30 bg-emerald-400/[0.06]" : run.terminal_kind === "recovered" ? "border-amber-400/30 bg-amber-400/[0.06]" : "border-red-400/30 bg-red-400/[0.06]")}><p className="text-[9px] uppercase tracking-wider text-muted-foreground">Persisted terminal result</p><p className="mt-1 text-sm font-semibold capitalize">{run.terminal_kind.replaceAll("_", " ")}</p>{run.terminal_kind === "recovered" && <p className="mt-1 text-[9px] text-amber-200">A recorded rejection was corrected. Review the retry/revision chain below; this is not a clean first-pass result.</p>}<div className="mt-2 flex flex-wrap gap-2 text-[8px] text-muted-foreground"><span>Pydantic AI retries {Object.values(run.internal_retry_counts ?? {}).reduce((sum, count) => sum + count, 0)}</span><span>Outer revisions {run.outer_revision_counts?.used ?? 0}/{run.outer_revision_counts?.budget ?? 0}</span></div><code className="mt-1 block truncate text-[8px] text-muted-foreground">run {run.run_id}</code></div>
    {run.output !== undefined && <details className="rounded-lg border border-border/30 bg-card/50 p-3"><summary className="cursor-pointer text-[10px] font-medium text-foreground">Persisted terminal payload</summary><pre className="mt-2 max-h-48 overflow-auto rounded bg-background/50 p-2 text-[8px] leading-4 text-muted-foreground">{JSON.stringify(run.output, null, 2)}</pre></details>}
    {run.containment_evidence && <div className="rounded-lg border border-border/30 bg-card/50 p-3"><p className="text-[10px] font-medium">Containment measurement</p>{run.containment_evidence.measurement_status === "not_measured" ? <p className="mt-1 text-[9px] text-muted-foreground">Not measured — this run did not carry a tracked injected-risk ID, so no containment or escape claim is made.</p> : <p className="mt-1 text-[9px] text-muted-foreground">Tracked {run.containment_evidence.injected_risk_ids.length} injected risk(s); contained {run.containment_evidence.contained_risk_ids.length}. Decision: {String(run.containment_evidence.decision)}</p>}</div>}
    {artifact.compiled_plan?.steps && <details className="rounded-lg border border-border/30 bg-card/50 p-3"><summary className="cursor-pointer text-[10px] font-medium">Executed operation provenance</summary><div className="mt-2 space-y-1">{artifact.compiled_plan.steps.filter((step) => run.events.some((event) => event.canvas_node_id === step.canvas_node_id)).map((step) => <div key={step.step_id} className="rounded bg-background/40 p-2 text-[8px]"><div className="flex justify-between"><span className="text-foreground">{step.operation_id}@{step.operation_version}</span><span className="text-cyan-300">{step.canvas_node_id}</span></div><p className="mt-0.5 text-muted-foreground">{step.lowerer_id}@{step.lowerer_version}</p><code className="text-muted-foreground/70">impl {step.implementation_fingerprint.slice(0, 16)}…</code></div>)}</div></details>}
    {mutationEvents.length > 0 && <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.05] p-3"><p className="text-[10px] font-medium text-amber-200">Controlled post-agent mutation</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">The fixture changed a handoff after Pydantic AI accepted the producer output and before the TypeAdapter gate. This is an external test hook, not a production graph node.</p>{mutationEvents.map((event) => <p key={event.event_id ?? event.sequence} className="mt-1 font-mono text-[8px] text-amber-200/80">removed {Array.isArray(event.payload?.removed_path) ? event.payload.removed_path.join(".") : "field"} · {String(event.payload?.target_contract_id ?? "handoff")}</p>)}</div>}
    {retrievalEvents.length > 0 && <KnowledgeRetrievalResults events={retrievalEvents} />}
    <MechanismResults icon={<Braces />} title="Pydantic AI output" subtitle="Structured-output validation inside executors" events={executorEvents} empty="No assured executor ran on this route." />
    <MechanismResults icon={<GitBranch />} title="TypeAdapter handoffs" subtitle="Strict boundary validation and actual routed ports" events={handoffEvents} empty="No Typed Handoff Gate ran on this route." />
    <MechanismResults icon={<ShieldCheck />} title="Independent evidence" subtitle="Grounding, policy, authorization, or task checks" events={evidenceEvents} empty="No Evidence Check ran on this route." />
    <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Routed event timeline</p><div className="space-y-1">{run.events.map((event) => <button key={`${event.sequence}-${event.event_type}`} onClick={() => event.canvas_node_id && useSimulatorStore.getState().selectNode(event.canvas_node_id)} className="flex w-full items-start gap-2 rounded border border-border/30 bg-card/40 px-2 py-1.5 text-left"><span className="w-5 text-[8px] text-muted-foreground">{event.sequence}</span><span className="flex-1 text-[9px] text-foreground">{event.event_type.replaceAll("_", " ")}</span><span className="max-w-24 truncate text-[8px] text-cyan-300">{event.canvas_node_id ?? event.canvas_edge_id ?? "runtime"}</span></button>)}</div></div>
    {(issues.length > 0 || warnings.length > 0) && <p className="text-[9px] text-muted-foreground">Compile provenance retained {issues.length} issues and {warnings.length} warnings.</p>}
  </div>;
}

function AssuranceEvalResults() {
  const scenario = useSimulatorStore((state) => state.currentScenario);
  const { artifact, capabilities, evalResult, status, busy, setBusy, setEval, setError } = useAssuranceStore();
  const suite = capabilities?.eval_suites?.[0];
  const runnable = artifact && suite && status !== "stale" && !busy;
  const runEval = async () => {
    if (!artifact || !suite) return;
    try { setBusy("eval"); setEval(await assuranceApi.evals(artifact, suite.suite_id, suite.suite_version)); }
    catch (error) { setError(error instanceof Error ? error.message : "Eval failed"); }
  };
  return <div className="space-y-4">
    <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.04] p-3"><Beaker className="h-4 w-4 text-violet-300" /><p className="mt-2 text-xs font-semibold">External Pydantic Evals</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">Versioned cases invoke real runs against the exact persisted candidate. Evals are not production graph nodes.</p></div>
    {!artifact && <EmptyAssurance title="No compiled candidate" description="Compile the current graph before running its eval dataset." />}
    {artifact && !suite && <EmptyAssurance title="No registered eval suite" description={`The ${scenario?.title ?? "scenario"} adapter did not advertise a complete suite.`} />}
    {artifact && suite && <div className="space-y-2 rounded border border-border/30 bg-card/50 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-medium">{suite.label ?? suite.suite_id}</p><p className="text-[9px] text-muted-foreground">{suite.suite_id} · v{suite.suite_version}</p></div><Button size="sm" onClick={runEval} disabled={!runnable} className="h-7 text-[10px]">{busy === "eval" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Beaker className="mr-1 h-3 w-3" />}Run Evals</Button></div>{status === "stale" && <p className="text-[9px] text-amber-300">Candidate is stale; recompile first.</p>}</div>}
    {evalResult && <div className="space-y-2"><div className="rounded border border-violet-400/20 bg-violet-400/[0.04] p-3"><p className="text-[9px] uppercase tracking-wider text-violet-300">Pydantic Evals · persisted</p><p className="mt-1 text-xs">{JSON.stringify(evalResult.aggregate ?? {})}</p></div>{evalResult.cases.map((item, index) => <div key={String(item.case_id ?? index)} className="rounded border border-border/30 bg-card/50 p-2 text-[9px]"><div className="flex justify-between"><span>{String(item.case_id ?? `case ${index + 1}`)}</span><span className={item.passed ? "text-emerald-300" : "text-red-300"}>{item.passed ? "passed" : "failed"}</span></div><p className="mt-1 text-muted-foreground">linked run {String(item.run_id ?? "missing")}</p></div>)}</div>}
  </div>;
}

function metricPercent(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "Not measured";
}

function KnowledgeRetrievalResults({ events }: { events: AssuranceEvent[] }) {
  return <div className="space-y-2 rounded-lg border border-cyan-400/25 bg-cyan-400/[0.045] p-3"><div className="flex items-start gap-2"><Database className="mt-0.5 h-3.5 w-3.5 text-cyan-300" /><div><p className="text-xs font-medium">Knowledge Retrieval</p><p className="text-[9px] text-muted-foreground">Deterministic ranked evidence with RAGAS-aligned fixture metrics</p></div></div>{events.map((event) => {
    const payload = event.payload ?? {};
    const metrics = payload.metrics && typeof payload.metrics === "object" ? payload.metrics as Record<string, unknown> : {};
    const retrieved = Array.isArray(payload.retrieved) ? payload.retrieved.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
    return <div key={`${event.sequence}-${event.canvas_node_id}`} className="rounded border border-cyan-400/15 bg-background/40 p-2.5"><div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="border-cyan-400/25 text-[8px] text-cyan-200">{String(payload.retrieval_mode ?? "unknown")}</Badge><span className="text-[8px] text-muted-foreground">top-{String(payload.top_k ?? "?")} · {String(payload.corpus_id ?? "unknown corpus")}</span><span className="ml-auto text-[8px] text-cyan-300">{event.canvas_node_id}</span></div><p className="mt-2 truncate text-[8px] text-muted-foreground" title={String(payload.query ?? "")}>query · {String(payload.query ?? "")}</p><div className="mt-2 grid grid-cols-2 gap-1">{[
      ["Context precision", metricPercent(metrics.context_precision), "Rank-aware precision across relevant returned chunks."],
      ["Context recall", metricPercent(metrics.context_recall), "Fraction of frozen relevant chunk IDs retrieved."],
      ["Context relevance", metricPercent(metrics.context_relevance), "Mean normalized retrieval score; deterministic diagnostic, not an LLM judge."],
      ["Faithfulness", "Not measured", "Faithfulness requires claims from a generated answer, so a retrieval-only node cannot honestly score it."],
    ].map(([label, value, help]) => <div key={label} className="rounded border border-border/25 bg-card/40 p-2"><div className="flex items-center gap-1"><p className="text-[8px] text-muted-foreground">{label}</p><Info className="h-2.5 w-2.5 text-muted-foreground/70" title={help} /></div><p className={cn("mt-0.5 text-[10px] font-medium", value === "Not measured" ? "text-amber-200" : "text-foreground")}>{value}</p></div>)}</div><details className="mt-2 rounded border border-border/25 bg-card/30"><summary className="cursor-pointer px-2 py-1.5 text-[8px] font-medium text-muted-foreground">Ranked chunks · {retrieved.length}</summary><div className="space-y-1 border-t border-border/20 p-2">{retrieved.map((chunk) => <div key={String(chunk.chunk_id)} className="rounded bg-background/45 p-2"><div className="flex items-center gap-1.5"><span className="text-[8px] text-muted-foreground">#{String(chunk.rank)}</span><span className="truncate text-[8px] text-foreground">{String(chunk.title)}</span><span className={cn("ml-auto text-[8px]", chunk.relevant ? "text-emerald-300" : "text-amber-300")}>{metricPercent(chunk.score)} · {chunk.relevant ? "relevant" : "distractor"}</span></div><p className="mt-1 line-clamp-2 text-[7px] leading-3 text-muted-foreground">{String(chunk.excerpt)}</p><code className="text-[7px] text-cyan-300/70">{String(chunk.source_id)} / {String(chunk.chunk_id)}</code></div>)}</div></details></div>;
  })}</div>;
}

function MechanismResults({ icon, title, subtitle, events, empty }: { icon: React.ReactNode; title: string; subtitle: string; events: AssuranceEvent[]; empty: string }) {
  return <div className="rounded-lg border border-border/30 bg-card/50 p-3"><div className="flex items-start gap-2"><span className="mt-0.5 text-cyan-300 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span><div><p className="text-xs font-medium">{title}</p><p className="text-[9px] text-muted-foreground">{subtitle}</p></div></div><div className="mt-2 space-y-1">{events.length ? events.map((event) => {
    const failed = /rejected|failed/.test(event.event_type) || event.payload?.decision === false;
    const retried = /retry|revision/.test(event.event_type);
    return <div key={`${event.sequence}-${event.event_type}`} className={cn("rounded border px-2 py-1.5 text-[9px]", failed ? "border-red-400/20 bg-red-400/[0.04]" : retried ? "border-amber-400/20 bg-amber-400/[0.04]" : "border-border/20 bg-background/40")}><div className="flex gap-1.5"><span className="text-muted-foreground">#{event.sequence}</span><span className={failed ? "text-red-200" : retried ? "text-amber-200" : "text-foreground"}>{event.event_type.replaceAll("_", " ")}</span><span className="ml-auto text-cyan-300">{event.canvas_node_id}</span></div><EventEvidence event={event} /></div>;
  }) : <p className="text-[9px] text-muted-foreground">{empty}</p>}</div></div>;
}

function EventEvidence({ event }: { event: AssuranceEvent }) {
  const payload = event.payload ?? {};
  const fields = [
    ["contract", payload.contract_id && `${String(payload.contract_id)}${payload.contract_version ? `@${String(payload.contract_version)}` : ""}`],
    ["method", payload.method],
    ["check", payload.check_id && `${String(payload.check_id)}${payload.version ? `@${String(payload.version)}` : ""}`],
    ["engine", payload.engine],
    ["mode", payload.output_mode],
    ["strict", typeof payload.strict === "boolean" ? payload.strict : undefined],
    ["requests", payload.request_count],
    ["retries", payload.retry_count],
    ["score", payload.score],
    ["decision", typeof payload.decision === "boolean" ? (payload.decision ? "passed" : "failed") : undefined],
    ["weight", payload.weight],
    ["retry", payload.validation_retry],
    ["checks", Array.isArray(payload.check_ids) ? payload.check_ids.join(", ") : undefined],
    ["operation", payload.operation_id],
    ["lowerer", payload.lowerer_id],
    ["implementation", typeof payload.implementation_fingerprint === "string" ? payload.implementation_fingerprint.slice(0, 12) : undefined],
  ].filter((item): item is [string, unknown] => item[1] !== undefined && item[1] !== null);
  const errors = Array.isArray(payload.errors) ? payload.errors as Array<Record<string, unknown>> : [];
  if (!fields.length && !errors.length) return null;
  return <div className="mt-1 space-y-1 text-[8px] text-muted-foreground"><div className="flex flex-wrap gap-x-2 gap-y-0.5">{fields.map(([label, value]) => <span key={label}><span className="text-muted-foreground/70">{label}</span> <span className={label === "decision" && value === "failed" ? "text-red-200" : "text-foreground/80"}>{String(value)}</span></span>)}</div>{errors.slice(0, 2).map((error, index) => <p key={index} className="font-mono text-red-200/80">{Array.isArray(error.path) ? error.path.join(".") : "output"}: {String(error.type ?? error.message ?? "validation error")}</p>)}</div>;
}

function EmptyAssurance({ title, description }: { title: string; description: string }) {
  return <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center"><ShieldCheck className="h-7 w-7 text-cyan-300/40" /><p className="mt-3 text-xs font-medium">{title}</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">{description}</p></div>;
}

function ResultModeTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center justify-center gap-1 rounded-md px-1.5 py-2 text-[10px] font-medium transition",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span>
      {children}
    </button>
  );
}

function AnalysisResults() {
  const deterministicResults = useSimulatorStore((state) => state.deterministicResults);
  const llmResults = useSimulatorStore((state) => state.llmResults);
  const isLLMLoading = useSimulatorStore((state) => state.isLLMLoading);
  const resultsStale = useSimulatorStore((state) => state.resultsStale);
  const scenario = useSimulatorStore((state) => state.currentScenario);

  if (!deterministicResults) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center px-4 text-center text-muted-foreground">
        <BarChart3 className="h-7 w-7 opacity-30" />
        <p className="mt-3 text-xs font-medium text-foreground">No design analysis yet</p>
        <p className="mt-1 text-[10px] leading-4">Use Analyze Design above to calculate heuristic architecture results.</p>
      </div>
    );
  }

  const costOk = scenario ? deterministicResults.cost <= scenario.maxCost : true;
  const latencyOk = scenario ? deterministicResults.latency <= scenario.maxLatency : true;
  const readinessOk = scenario ? deterministicResults.scenarioReadiness >= scenario.minReliability : true;
  const deterministicPass = costOk && latencyOk && readinessOk;
  const llmPass = llmResults
    ? llmResults.overall.architectureScore >= (scenario?.llmThresholds.minArchitectureScore || 0) &&
      llmResults.overall.promptScore >= (scenario?.llmThresholds.minPromptScore || 0)
    : false;
  const overallPass = deterministicPass && (llmResults ? llmPass : false);

  return (
    <div className={cn("space-y-4", resultsStale && "opacity-60")}>
      <div className="rounded-lg border border-blue-400/20 bg-blue-400/[0.04] p-2.5 text-[9px] leading-4 text-muted-foreground">
        Design analysis is heuristic. Runtime evidence appears under Run and Evals.
      </div>
      {resultsStale && <Badge variant="outline" className="text-xs">Previous analysis — graph has changed</Badge>}

      <div className={cn(
        "rounded-lg border p-3 text-center",
        overallPass
          ? "border-emerald-500/50 bg-emerald-500/10"
          : isLLMLoading
            ? "border-amber-500/50 bg-amber-500/10"
            : "border-destructive/50 bg-destructive/10",
      )}>
        {isLLMLoading ? (
          <div className="flex items-center justify-center gap-2 text-amber-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Analyzing prompts...</span>
          </div>
        ) : overallPass ? (
          <div className="flex items-center justify-center gap-2 text-emerald-400">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-semibold">PASS</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" />
            <span className="text-sm font-semibold">FAIL</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">Architecture metrics</h4>
        <ScoreRow label="Cost · estimated" value={`$${deterministicResults.intervals.cost.low.toFixed(4)}–$${deterministicResults.intervals.cost.high.toFixed(4)}`} ok={costOk} />
        <ScoreRow label="Latency · estimated" value={`${deterministicResults.intervals.latency.low.toFixed(1)}–${deterministicResults.intervals.latency.high.toFixed(1)}s`} ok={latencyOk} />
        <ScoreRow label="Scenario readiness · heuristic" value={`${deterministicResults.scenarioReadiness}/100`} ok={readinessOk} />
        <ScoreRow label="Task pass" value="Not measured" ok={null} />
      </div>

      {(deterministicResults.bonuses.length > 0 || deterministicResults.penalties.length > 0) && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Breakdown</h4>
          {deterministicResults.bonuses.map((bonus) => (
            <div key={bonus.label} className="flex justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{bonus.label}</span>
              <span className="font-medium text-emerald-400">+{bonus.value} pts</span>
            </div>
          ))}
          {deterministicResults.penalties.map((penalty) => (
            <div key={penalty.label} className="flex justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{penalty.label}</span>
              <span className="font-medium text-destructive">{penalty.value} pts</span>
            </div>
          ))}
        </div>
      )}

      {deterministicResults.warnings.length > 0 && (
        <div className="space-y-1">
          <h4 className="flex items-center gap-1 text-xs font-semibold uppercase text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Warnings
          </h4>
          {deterministicResults.warnings.map((warning) => (
            <p key={warning} className="rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">{warning}</p>
          ))}
        </div>
      )}

      {isLLMLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Waiting for prompt analysis...
        </div>
      )}

      {llmResults && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Prompt analysis (AI)</h4>
          <div className="grid grid-cols-2 gap-2">
            <ScoreBox label="Architecture" score={llmResults.overall.architectureScore} threshold={scenario?.llmThresholds.minArchitectureScore || 0} />
            <ScoreBox label="Prompt quality" score={llmResults.overall.promptScore} threshold={scenario?.llmThresholds.minPromptScore || 0} />
          </div>
          <p className="text-xs text-muted-foreground">{llmResults.overall.feedback}</p>
          {llmResults.overall.suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">Suggestions</p>
              {llmResults.overall.suggestions.map((suggestion) => (
                <p key={suggestion} className="rounded bg-muted/50 px-2 py-1 text-xs text-muted-foreground">{suggestion}</p>
              ))}
            </div>
          )}
          {llmResults.perNode.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Per-node feedback</p>
              {llmResults.perNode.map((node) => (
                <div key={node.nodeId} className="space-y-1 rounded border border-border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{node.nodeId}</span>
                    <Badge variant={node.promptScore >= 60 ? "default" : "destructive"} className="text-[10px]">{node.promptScore}/100</Badge>
                  </div>
                  <p className="text-muted-foreground">{node.feedback}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isLLMLoading && !llmResults && (
        <div className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
          Prompt analysis unavailable — showing deterministic results only.
        </div>
      )}
    </div>
  );
}

function DesignOnlyRuntime() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-5">
      <Code2 className="h-6 w-6 text-violet-300" />
      <p className="mt-3 text-[10px] font-medium uppercase tracking-wider text-violet-300">Design only</p>
      <h3 className="mt-1 text-sm font-semibold">No registered runtime yet</h3>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        This canvas can be analyzed, but ReAgent will not fabricate execution traces or eval results.
      </p>
      <div className="mt-4 space-y-2 text-[9px] leading-4 text-muted-foreground">
        <p>• Map nodes to runtime implementations</p>
        <p>• Bind typed handoff contracts</p>
        <p>• Add deterministic fixtures and eval cases</p>
      </div>
    </div>
  );
}

function CheckingRuntime() {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center text-center">
      <CircleDashed className="h-6 w-6 animate-spin text-cyan-300" />
      <p className="mt-3 text-xs font-medium">Checking runtime</p>
      <p className="mt-1 text-[10px] text-muted-foreground">Reading scenario capabilities.</p>
    </div>
  );
}

function OfflineRuntime() {
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.035] p-5">
      <ServerOff className="h-6 w-6 text-amber-300" />
      <h3 className="mt-3 text-sm font-semibold">Runtime offline</h3>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        Start the Python runtime on port 8000 to execute this registered scenario.
      </p>
    </div>
  );
}

function ScoreRow({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium", ok === null ? "text-muted-foreground" : ok ? "text-emerald-400" : "text-destructive")}>
        {value} {ok === null ? null : ok ? <CheckCircle className="inline h-3 w-3" /> : <XCircle className="inline h-3 w-3" />}
      </span>
    </div>
  );
}

function ScoreBox({ label, score, threshold }: { label: string; score: number; threshold: number }) {
  const ok = score >= threshold;
  return (
    <div className={cn("rounded border p-2 text-center", ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5")}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold", ok ? "text-emerald-400" : "text-destructive")}>{score}</p>
      <p className="text-[10px] text-muted-foreground">min: {threshold}</p>
    </div>
  );
}

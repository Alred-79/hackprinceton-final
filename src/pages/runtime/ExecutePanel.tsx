import {
  AlertTriangle,
  BookOpenCheck,
  GitCompareArrows,
  Loader2,
  Maximize2,
  Play,
  ShieldCheck,
} from "lucide-react";
import type { RunRecord, RuntimeScenarioDefinition } from "@/types/runtime";
import { useRuntimeStore } from "@/store/runtimeStore";
import { RunCard } from "./RunCard";

export function ExecutePanel({
  scenarioId,
  disabled,
  compact = false,
  onExpand,
  runtimeDefinition,
}: {
  scenarioId: string;
  disabled: boolean;
  compact?: boolean;
  onExpand?: () => void;
  runtimeDefinition?: RuntimeScenarioDefinition | null;
}) {
  const baseline = useRuntimeStore((state) => state.baseline);
  const hardened = useRuntimeStore((state) => state.hardened);
  const loading = useRuntimeStore((state) => state.runLoading);
  const error = useRuntimeStore((state) => state.runError);
  const runVariant = useRuntimeStore((state) => state.runVariant);
  const runPair = useRuntimeStore((state) => state.runPair);
  const resolveApproval = useRuntimeStore((state) => state.resolveApproval);
  const replay = useRuntimeStore((state) => state.replay);
  const selectedPreset = useRuntimeStore((state) => state.selectedFixturePreset);
  const setSelectedPreset = useRuntimeStore((state) => state.setSelectedFixturePreset);
  const activePreset = selectedPreset ?? runtimeDefinition?.default_fixture_preset ?? null;

  const run = (variant: RunRecord["variant"]) => {
    void runVariant(scenarioId, variant, activePreset);
  };
  const runRegisteredPair = () => void runPair(scenarioId, activePreset);

  if (compact) {
    return (
      <CompactExecution
        baseline={baseline}
        hardened={hardened}
        loading={loading !== null}
        error={error}
        disabled={disabled}
        onRun={runRegisteredPair}
        onExpand={onExpand}
        onResolveApproval={(decision) => void resolveApproval(decision)}
        runtimeDefinition={runtimeDefinition}
        activePreset={activePreset}
        onPresetChange={setSelectedPreset}
      />
    );
  }

  return (
    <section>
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-cyan-400">Guided runtime proof</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
            {runtimeDefinition?.title ?? "Registered scenario"} · paired contract experiment
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {runtimeDefinition?.summary ?? "Both variants receive the same deterministic fixture so contract enforcement and task quality can be compared directly."}
          </p>
        </div>
        <button
          onClick={runRegisteredPair}
          disabled={disabled || loading !== null}
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading === "pair" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
          Run paired experiment
        </button>
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {runtimeDefinition && (
        <GuidedFixtureLab
          definition={runtimeDefinition}
          activePreset={activePreset}
          onPresetChange={setSelectedPreset}
        />
      )}

      <WorkflowStrip definition={runtimeDefinition} />

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <RunCard
          variant="baseline"
          run={baseline}
          loading={loading === "baseline" || loading === "pair"}
          onRun={() => run("baseline")}
          onReplay={() => baseline && void replay(baseline)}
        />
        <RunCard
          variant="hardened"
          run={hardened}
          loading={loading === "hardened" || loading === "pair"}
          onRun={() => run("hardened")}
          onReplay={() => hardened && void replay(hardened)}
          onResolveApproval={(decision) => void resolveApproval(decision)}
        />
      </div>

      {baseline?.metrics && hardened?.metrics && hardened.terminal_status === "succeeded" && (
        <Comparison baseline={baseline} hardened={hardened} />
      )}
    </section>
  );
}

function CompactExecution({
  baseline,
  hardened,
  loading,
  error,
  disabled,
  onRun,
  onExpand,
  onResolveApproval,
  runtimeDefinition,
  activePreset,
  onPresetChange,
}: {
  baseline: RunRecord | null;
  hardened: RunRecord | null;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onRun: () => void;
  onExpand?: () => void;
  onResolveApproval: (decision: "approved" | "denied") => void;
  runtimeDefinition?: RuntimeScenarioDefinition | null;
  activePreset: string | null;
  onPresetChange: (preset: string) => void;
}) {
  const pending = hardened?.pending_approvals.find((item) => item.status === "pending");
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200">
          <ShieldCheck className="h-3.5 w-3.5" /> Registered runtime
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Executes the registered baseline and hardened workflow. It does not execute unsaved canvas edits.
        </p>
      </div>

      {runtimeDefinition && (
        <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.035] p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold text-violet-200">
            <BookOpenCheck className="h-3.5 w-3.5" /> Guided Pydantic fixture
          </div>
          <select
            value={activePreset ?? ""}
            onChange={(event) => onPresetChange(event.target.value)}
            className="mt-2 w-full rounded-md border border-white/10 bg-[#0d121d] px-2 py-2 text-[10px] text-foreground"
          >
            {Object.keys(runtimeDefinition.fixture_presets).map((preset) => (
              <option key={preset} value={preset}>{preset.replaceAll("_", " ")}</option>
            ))}
          </select>
          <p className="mt-2 text-[9px] leading-4 text-muted-foreground">
            {activePreset ? runtimeDefinition.fixture_presets[activePreset] : "Select a deterministic teaching case."}
          </p>
        </div>
      )}

      <button
        onClick={onRun}
        disabled={disabled || loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-3 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {loading ? "Running workflow…" : "Run registered workflow"}
      </button>

      {error && (
        <div className="flex gap-2 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-[10px] leading-4 text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <CompactRunStatus label="Baseline" run={baseline} tone="red" />
        <CompactRunStatus label="Hardened" run={hardened} tone="green" />
      </div>

      {pending && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-3">
          <p className="text-[10px] font-semibold text-amber-200">Human approval required</p>
          <p className="mt-1 text-[9px] leading-4 text-muted-foreground">Publication is paused at a validated checkpoint.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => onResolveApproval("approved")} disabled={loading} className="flex-1 rounded bg-emerald-400 px-2 py-1.5 text-[10px] font-semibold text-slate-950 disabled:opacity-40">
              Approve
            </button>
            <button onClick={() => onResolveApproval("denied")} disabled={loading} className="flex-1 rounded border border-red-400/30 px-2 py-1.5 text-[10px] text-red-200 disabled:opacity-40">
              Deny
            </button>
          </div>
        </div>
      )}

      {baseline?.metrics && hardened?.metrics && hardened.terminal_status === "succeeded" && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-black/15 p-3">
          <CompactDelta label="Critical escape" before={measuredBoolean(baseline.metrics, "critical_output_escape")} after={measuredBoolean(hardened.metrics, "critical_output_escape")} />
          <CompactDelta label="Containment" before={measuredBoolean(baseline.metrics, "containment")} after={measuredBoolean(hardened.metrics, "containment")} />
          <CompactDelta label="Task pass" before={baseline.metrics.task_pass ? "Pass" : "Fail"} after={hardened.metrics.task_pass ? "Pass" : "Fail"} />
        </div>
      )}

      {onExpand && (
        <button onClick={onExpand} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-medium text-muted-foreground transition hover:bg-white/5 hover:text-foreground">
          <Maximize2 className="h-3 w-3" /> Expand traces and replay
        </button>
      )}
    </div>
  );
}

function CompactRunStatus({
  label,
  run,
  tone,
}: {
  label: string;
  run: RunRecord | null;
  tone: "red" | "green";
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-2.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xs font-semibold ${tone === "green" ? "text-emerald-300" : "text-red-300"}`}>
        {run?.terminal_status.replace("_", " ") ?? "Not run"}
      </p>
      <p className="mt-1 text-[8px] text-muted-foreground">
        {run ? `${run.events.length} events · ${run.pydantic_evidence.length} Pydantic checks` : "No evidence yet"}
      </p>
    </div>
  );
}

function CompactDelta({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-[9px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-red-300/70 line-through">{before}</span>
      <span className="font-medium text-emerald-300">{after}</span>
    </div>
  );
}

function WorkflowStrip({ definition }: { definition?: RuntimeScenarioDefinition | null }) {
  const nodes = definition
    ? [
        { name: definition.producer_name, badges: ["Pydantic AI", definition.contracts.handoff] },
        { name: "Edge validator", badges: ["TypeAdapter", "Trust boundary"] },
        { name: definition.consumer_name, badges: ["Pydantic AI", definition.contracts.output] },
        { name: "Quality checks", badges: ["Independent", "Schema ≠ truth"] },
      ]
    : [
        { name: "Enricher", badges: ["Pydantic AI", "Contracted"] },
        { name: "Edge validator", badges: ["TypeAdapter", "Trust boundary"] },
        { name: "Analyst", badges: ["Pydantic AI", "Contracted"] },
        { name: "Factuality", badges: ["Independent", "Semantic check"] },
      ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex min-w-[760px] items-center gap-3">
        {nodes.map((node, index) => (
          <div key={node.name} className="contents">
            <div className="min-w-40 rounded-xl border border-white/10 bg-[#0d121d] p-3">
              <p className="text-xs font-semibold">{node.name}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {node.badges.map((badge) => (
                  <span key={badge} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    {badge}
                  </span>
                ))}
              </div>
            </div>
            {index < nodes.length - 1 && <div className="h-px flex-1 bg-gradient-to-r from-cyan-400/60 to-violet-400/40" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Comparison({ baseline, hardened }: { baseline: RunRecord; hardened: RunRecord }) {
  const before = baseline.metrics!;
  const after = hardened.metrics!;
  return (
    <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.035] p-5">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-cyan-300" />
        <h3 className="text-sm font-semibold">Paired result · same case, input, and seed</h3>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Delta label="Critical-output escape" before={measuredBoolean(before, "critical_output_escape")} after={measuredBoolean(after, "critical_output_escape")} good={after.critical_output_escape === false} />
        <Delta label="Containment" before={measuredBoolean(before, "containment")} after={measuredBoolean(after, "containment")} good={after.containment === true} />
        <Delta label="Task completion" before={before.task_pass ? "Pass" : "Fail"} after={after.task_pass ? "Pass" : "Fail"} good={Boolean(after.task_pass)} />
        <Delta label="Schema vs task quality" before={before.task_pass ? "Pass" : "Typed output, task failed"} after={after.task_pass ? "Contract + task pass" : "Still failing"} good={Boolean(after.task_pass)} />
      </div>
    </div>
  );
}

function measuredBoolean(
  metrics: NonNullable<RunRecord["metrics"]>,
  key: "critical_output_escape" | "containment",
): string {
  if (metrics.labels[key] === "not_measured" || metrics[key] === null) {
    return "Not measured";
  }
  return metrics[key] ? "Yes" : "No";
}

function GuidedFixtureLab({
  definition,
  activePreset,
  onPresetChange,
}: {
  definition: RuntimeScenarioDefinition;
  activePreset: string | null;
  onPresetChange: (preset: string) => void;
}) {
  return (
    <div className="mb-5 grid gap-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.035] p-5 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-200">
          <BookOpenCheck className="h-4 w-4" /> Guided Pydantic fixture lab
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          This is a deterministic teaching fixture, but the execution is real: LangGraph runs the nodes,
          Pydantic AI validates agent output, and a TypeAdapter validates the handoff again.
        </p>
        <label className="mt-4 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Failure mode
        </label>
        <select
          value={activePreset ?? ""}
          onChange={(event) => onPresetChange(event.target.value)}
          className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d121d] px-3 py-2.5 text-xs text-foreground"
        >
          {Object.keys(definition.fixture_presets).map((preset) => (
            <option key={preset} value={preset}>{preset.replaceAll("_", " ")}</option>
          ))}
        </select>
        <p className="mt-2 text-[10px] leading-5 text-violet-100/70">
          {activePreset ? definition.fixture_presets[activePreset] : "Choose a versioned fixture."}
        </p>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">What to inspect</p>
        <div className="mt-2 space-y-2">
          {definition.pydantic_lessons.slice(0, 4).map((lesson, index) => (
            <div key={lesson} className="flex gap-2 rounded-lg border border-white/10 bg-black/15 p-2.5 text-[10px] leading-4 text-muted-foreground">
              <span className="font-mono text-violet-300">0{index + 1}</span>
              <span>{lesson}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Delta({ label, before, after, good }: { label: string; before: string; after: string; good: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-xs text-red-300/80 line-through decoration-red-400/40">{before}</p>
      <p className={`mt-1 text-sm font-semibold ${good ? "text-emerald-300" : "text-amber-300"}`}>{after}</p>
    </div>
  );
}

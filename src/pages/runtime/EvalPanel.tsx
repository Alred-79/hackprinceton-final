import { AlertTriangle, Beaker, Check, ChevronDown, Loader2, Maximize2, X } from "lucide-react";
import type { EvalReport } from "@/types/runtime";
import { useRuntimeStore } from "@/store/runtimeStore";

export function EvalPanel({
  scenarioId,
  disabled,
  compact = false,
  onExpand,
}: {
  scenarioId: string;
  disabled: boolean;
  compact?: boolean;
  onExpand?: () => void;
}) {
  const report = useRuntimeStore((state) => state.evalReport);
  const loading = useRuntimeStore((state) => state.evalLoading);
  const error = useRuntimeStore((state) => state.evalError);
  const runEvals = useRuntimeStore((state) => state.runEvals);
  const run = () => void runEvals(scenarioId);

  if (compact) {
    return (
      <CompactEval
        report={report}
        loading={loading}
        error={error}
        disabled={disabled}
        onRun={run}
        onExpand={onExpand}
      />
    );
  }

  return (
    <section className="mx-auto max-w-6xl">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-400">Pydantic Evals</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Failure-mode regression suite</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Versioned cases return a normalized subject and run ordinary custom evaluators. Fixture outcomes are
            deterministic regression evidence and are never pooled with live-model statistics.
          </p>
        </div>
        <button onClick={run} disabled={disabled || loading} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-400 px-4 text-xs font-semibold text-slate-950 transition hover:bg-violet-300 disabled:opacity-40">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Beaker className="h-4 w-4" />}
          {loading ? "Running cases…" : "Run fixture suite"}
        </button>
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4" /> {error}
        </div>
      )}

      {!report && !loading && (
        <div className="mt-8 rounded-2xl border border-dashed border-white/10 py-24 text-center text-muted-foreground">
          <Beaker className="mx-auto h-8 w-8 opacity-25" />
          <p className="mt-3 text-xs">Run the suite to produce a machine-readable report.</p>
        </div>
      )}

      {report && (
        <>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <Summary label="Suite" value={report.suite_version} />
            <Summary label="Passed" value={`${report.passed} / ${report.cases.length}`} positive={report.failed === 0} />
            <Summary label="Engine" value={report.engine} />
          </div>
          <div className="mt-4 space-y-2">
            {report.cases.map((evalCase) => (
              <details key={evalCase.name} className="group rounded-xl border border-white/10 bg-white/[0.025]">
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${evalCase.passed ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>
                    {evalCase.passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  </span>
                  <div>
                    <p className="text-xs font-semibold">{evalCase.name.replaceAll("_", " ")}</p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">case v{evalCase.version}</p>
                  </div>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] ${evalCase.passed ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>
                    {evalCase.passed ? "PASS" : "FAIL"}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition group-open:rotate-180" />
                </summary>
                <div className="grid gap-4 border-t border-white/10 p-4 md:grid-cols-2">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Assertions</p>
                    <div className="mt-2 space-y-1.5">
                      {Object.entries(evalCase.assertions).map(([name, passed]) => (
                        <div key={name} className="flex items-center gap-2 text-[10px]">
                          {passed ? <Check className="h-3 w-3 text-emerald-300" /> : <X className="h-3 w-3 text-red-300" />}
                          {name.replaceAll("_", " ")}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Mutation and evidence</p>
                    <pre className="mt-2 overflow-auto rounded-lg bg-black/25 p-2 text-[9px] leading-5 text-slate-300">{JSON.stringify(evalCase.mutation_plan, null, 2)}</pre>
                    <p className="mt-2 text-[9px] leading-4 text-muted-foreground">{evalCase.evidence.join(" · ")}</p>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CompactEval({
  report,
  loading,
  error,
  disabled,
  onRun,
  onExpand,
}: {
  report: EvalReport | null;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onRun: () => void;
  onExpand?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.04] p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-200">
          <Beaker className="h-3.5 w-3.5" /> Failure-mode regression
        </div>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          Runs versioned deterministic cases against this scenario's registered runtime.
        </p>
      </div>

      <button onClick={onRun} disabled={disabled || loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-400 px-3 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-40">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Beaker className="h-3.5 w-3.5" />}
        {loading ? "Running cases…" : "Run eval suite"}
      </button>

      {error && (
        <div className="flex gap-2 rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-[10px] leading-4 text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {report ? (
        <div className={`rounded-lg border p-4 text-center ${report.failed === 0 ? "border-emerald-400/25 bg-emerald-400/[0.04]" : "border-red-400/25 bg-red-400/[0.04]"}`}>
          <p className="text-2xl font-semibold">{report.passed}/{report.cases.length}</p>
          <p className={`mt-1 text-[10px] font-medium ${report.failed === 0 ? "text-emerald-300" : "text-red-300"}`}>
            {report.failed === 0 ? "All cases passed" : `${report.failed} case${report.failed === 1 ? "" : "s"} failed`}
          </p>
          <p className="mt-2 text-[9px] text-muted-foreground">{report.suite_version} · {report.engine}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-[10px] text-muted-foreground">
          No eval evidence yet.
        </div>
      )}

      {onExpand && (
        <button onClick={onExpand} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-medium text-muted-foreground transition hover:bg-white/5 hover:text-foreground">
          <Maximize2 className="h-3 w-3" /> Expand eval report
        </button>
      )}
    </div>
  );
}

function Summary({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${positive ? "text-emerald-300" : ""}`}>{value}</p>
    </div>
  );
}

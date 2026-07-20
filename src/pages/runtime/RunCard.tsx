import { Check, ChevronRight, Clock3, DatabaseZap, Loader2, Play, RotateCcw, ShieldAlert, X } from "lucide-react";
import type {
  ClaimAssessment,
  PydanticEvidence,
  RunEvent,
  RunRecord,
  RunVariant,
} from "@/types/runtime";

interface RunCardProps {
  variant: RunVariant;
  run: RunRecord | null;
  loading: boolean;
  onRun: () => void;
  onReplay: () => void;
  onResolveApproval?: (decision: "approved" | "denied") => void;
}

const IMPORTANT_EVENTS = new Set([
  "agent_output_retry",
  "edge_contract_rejected",
  "handoff_validation",
  "factuality_assessment",
  "citation_assessment",
  "approval_requested",
  "approval_resolved",
  "tool_call",
  "run_finished",
]);

export function RunCard({
  variant,
  run,
  loading,
  onRun,
  onReplay,
  onResolveApproval,
}: RunCardProps) {
  const isHardened = variant === "hardened";
  const pending = run?.pending_approvals.find((item) => item.status === "pending");
  const timeline = run?.events.filter((event) => IMPORTANT_EVENTS.has(event.kind)) ?? [];

  return (
    <article className={`rounded-2xl border bg-white/[0.025] ${
      isHardened ? "border-emerald-400/20" : "border-red-400/15"
    }`}>
      <div className="flex items-start gap-3 border-b border-white/10 p-5">
        <div className={`rounded-lg p-2 ${isHardened ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>
          {isHardened ? <DatabaseZap className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{isHardened ? "Hardened graph" : "Baseline graph"}</h3>
            <Status status={run?.terminal_status ?? "not_run"} />
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {isHardened
              ? "Typed outputs · edge validation · independent task-quality policy"
              : "Same typed contracts · intentionally weak semantic policy"}
          </p>
        </div>
        <button
          onClick={onRun}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-medium transition hover:border-white/20 hover:bg-white/5 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run
        </button>
      </div>

      {!run ? (
        <div className="flex h-72 flex-col items-center justify-center p-6 text-center text-muted-foreground">
          <Play className="mb-3 h-7 w-7 opacity-30" />
          <p className="text-xs">No execution trace yet</p>
          <p className="mt-1 text-[10px]">Fixture mode makes zero provider requests.</p>
        </div>
      ) : (
        <div className="space-y-5 p-5">
          {run.failure_reason && (
            <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">
              {run.failure_reason}
            </div>
          )}
          <MetricGrid run={run} />
          {run.replay_comparison && (
            <div className={`rounded-xl border p-3 ${
              run.replay_comparison.semantic_trace_match
                ? "border-emerald-400/25 bg-emerald-400/[0.055]"
                : "border-red-400/25 bg-red-400/[0.055]"
            }`}>
              <p className="text-[10px] font-semibold text-emerald-200">
                Strict replay {run.replay_comparison.semantic_trace_match ? "matched" : "diverged"}
              </p>
              <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                Semantic trace comparison · {run.replay_comparison.external_requests} external requests · volatile IDs and timing excluded
              </p>
            </div>
          )}
          <PydanticEvidenceTrail evidence={run.pydantic_evidence} />
          {run.claim_assessments.length > 0 && (
            <Cascade assessments={run.claim_assessments} variant={variant} />
          )}
          {pending && onResolveApproval && (
            <ApprovalCard
              approval={pending}
              onResolve={onResolveApproval}
              loading={loading}
            />
          )}
          <Timeline events={timeline} />
          {Object.keys(run.outputs).length > 0 && (
            <details className="group rounded-xl border border-white/10 bg-black/20">
              <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-[11px] font-medium">
                <ChevronRight className="h-3 w-3 transition group-open:rotate-90" /> Final typed output
              </summary>
              <pre className="max-h-56 overflow-auto border-t border-white/10 p-3 text-[10px] leading-5 text-slate-300">
                {JSON.stringify(run.outputs, null, 2)}
              </pre>
            </details>
          )}
          {run.terminal_status === "succeeded" && (
            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <div className="text-[9px] text-muted-foreground">
                semantic trace <span className="font-mono">{run.semantic_trace_hash?.slice(0, 12)}</span>
              </div>
              <button onClick={onReplay} disabled={loading} className="flex items-center gap-1.5 text-[10px] text-cyan-300 hover:text-cyan-200 disabled:opacity-40">
                <RotateCcw className="h-3 w-3" /> Strict fixture replay
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function PydanticEvidenceTrail({ evidence }: { evidence: PydanticEvidence[] }) {
  const repaired = evidence.filter((item) => item.status === "repaired").length;
  const semanticFailures = evidence.filter(
    (item) => item.layer === "task_quality" && ["failed", "rejected"].includes(item.status),
  ).length;
  if (evidence.length === 0) return null;

  return (
    <details open className="group rounded-xl border border-violet-400/20 bg-violet-400/[0.035]">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3">
        <ChevronRight className="h-3 w-3 text-violet-300 transition group-open:rotate-90" />
        <div>
          <p className="text-[10px] font-semibold text-violet-200">Pydantic enforcement evidence</p>
          <p className="mt-0.5 text-[8px] text-muted-foreground">
            {evidence.length} checks · {repaired} repaired · {semanticFailures} independent quality failures
          </p>
        </div>
      </summary>
      <div className="space-y-2 border-t border-white/10 p-3">
        {evidence.map((item, index) => (
          <details key={item.evidence_id} open={index < 2} className="group/item rounded-lg border border-white/10 bg-black/20">
            <summary className="flex cursor-pointer list-none items-start gap-2 p-2.5">
              <EvidenceStatus status={item.status} />
              <div className="min-w-0">
                <p className="truncate text-[10px] font-medium">{item.title}</p>
                <p className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground">
                  {item.layer.replaceAll("_", " ")} · {item.guarantee}
                  {item.contract_name ? ` · ${item.contract_name}` : ""}
                </p>
              </div>
              <ChevronRight className="ml-auto mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition group-open/item:rotate-90" />
            </summary>
            <div className="space-y-2 border-t border-white/10 p-2.5 text-[9px] leading-4">
              <p className="text-slate-300">{item.explanation}</p>
              <p className="rounded border border-violet-400/15 bg-violet-400/[0.04] p-2 text-violet-100/70">
                {item.teaching_note}
              </p>
              {item.validation_errors.length > 0 && (
                <div>
                  <p className="font-medium text-amber-200">Exact validation feedback</p>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/30 p-2 text-[8px] text-amber-100/75">
                    {JSON.stringify(item.validation_errors, null, 2)}
                  </pre>
                </div>
              )}
              {Object.keys(item.schema_excerpt).length > 0 && (
                <details>
                  <summary className="cursor-pointer text-cyan-300">View JSON schema excerpt</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[8px] text-slate-300">
                    {JSON.stringify(item.schema_excerpt, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

function EvidenceStatus({ status }: { status: PydanticEvidence["status"] }) {
  const positive = status === "passed";
  const repaired = status === "repaired";
  return (
    <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[8px] font-medium uppercase ${
      positive
        ? "bg-emerald-400/10 text-emerald-300"
        : repaired
          ? "bg-amber-400/10 text-amber-200"
          : "bg-red-400/10 text-red-300"
    }`}>
      {status}
    </span>
  );
}

function MetricGrid({ run }: { run: RunRecord }) {
  const metrics = run.metrics;
  const values = [
    { label: "Duration", value: metrics ? `${Math.round(metrics.duration_ms)} ms` : "Not measured", kind: "Observed" },
    { label: "Model requests", value: metrics?.request_count ?? "—", kind: "Observed" },
    { label: "Final contract", value: metrics ? (metrics.final_contract_pass ? "Pass" : "Fail") : "—", kind: "Observed" },
    { label: "Task pass", value: metrics?.task_pass == null ? "Not measured" : metrics.task_pass ? "Pass" : "Fail", kind: metrics?.task_pass == null ? "Not measured" : "Observed" },
    { label: "Cost", value: "Not measured", kind: "No billing data" },
    { label: "External requests", value: run.external_requests, kind: "Observed" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {values.map((item) => (
        <div key={item.label} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-xs font-semibold">{item.value}</p>
          <p className="mt-1 text-[8px] text-cyan-300/70">{item.kind}</p>
        </div>
      ))}
    </div>
  );
}

function Cascade({ assessments, variant }: { assessments: ClaimAssessment[]; variant: RunVariant }) {
  const nodes = ["enricher", "analyst", "factuality", "output"];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cascade lineage</p>
        <p className="text-[9px] text-muted-foreground">authoritative fixture assessment</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {nodes.map((node) => {
          const nodeAssessments = assessments.filter((item) => item.node_id === node);
          const value = nodeAssessments.some((item) => item.assessment === "unsupported")
            ? node === "factuality" ? "rejected" : "propagated"
            : nodeAssessments.some((item) => item.assessment === "supported")
              ? "supported"
              : variant === "baseline" && node === "factuality" ? "absent" : "clear";
          return (
            <div key={node} className={`rounded-lg border p-2 text-center ${cascadeColor(value)}`}>
              <p className="truncate text-[9px] capitalize">{node}</p>
              <p className="mt-1 truncate text-[8px] uppercase tracking-wider opacity-80">{value}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  onResolve,
  loading,
}: {
  approval: RunRecord["pending_approvals"][number];
  onResolve: (decision: "approved" | "denied") => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.055] p-4">
      <div className="flex items-center gap-2 text-amber-200">
        <Clock3 className="h-4 w-4" />
        <p className="text-xs font-semibold">Approval checkpoint</p>
      </div>
      <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
        The server retained the validated arguments. This client sends only the approval ID, decision, and idempotency key.
      </p>
      <pre className="mt-3 overflow-auto rounded-lg bg-black/30 p-2 text-[9px] text-slate-300">
        {JSON.stringify(approval.arguments, null, 2)}
      </pre>
      <div className="mt-3 flex gap-2">
        <button disabled={loading} onClick={() => onResolve("approved")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-2 text-[10px] font-semibold text-slate-950 disabled:opacity-40">
          <Check className="h-3.5 w-3.5" /> Approve
        </button>
        <button disabled={loading} onClick={() => onResolve("denied")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-400/25 px-3 py-2 text-[10px] font-semibold text-red-200 disabled:opacity-40">
          <X className="h-3.5 w-3.5" /> Deny
        </button>
      </div>
    </div>
  );
}

function Timeline({ events }: { events: RunEvent[] }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Normalized events</p>
      <div className="max-h-64 space-y-1.5 overflow-auto pr-1">
        {events.map((event) => (
          <div key={event.event_id} className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-black/20 p-2">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${eventColor(event.kind)}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[9px] font-medium">{event.kind.replaceAll("_", " ")}</p>
                <span className="shrink-0 text-[8px] text-muted-foreground">{event.node_id ?? "runtime"}</span>
              </div>
              {event.validation_errors.length > 0 && (
                <p className="mt-1 text-[8px] text-red-300">{event.validation_errors.join(" · ")}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Status({ status }: { status: RunRecord["terminal_status"] | "not_run" }) {
  const style = status === "succeeded" ? "bg-emerald-400/10 text-emerald-300" :
    status === "paused" ? "bg-amber-400/10 text-amber-300" :
    status === "failed" ? "bg-red-400/10 text-red-300" : "bg-white/5 text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[8px] font-medium uppercase tracking-wider ${style}`}>{status.replace("_", " ")}</span>;
}

function cascadeColor(value: string) {
  if (value === "propagated") return "border-red-400/25 bg-red-400/10 text-red-200";
  if (value === "rejected") return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  if (value === "supported") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  return "border-white/10 bg-white/[0.025] text-muted-foreground";
}

function eventColor(kind: string) {
  if (kind.includes("rejected") || kind.includes("retry")) return "bg-red-400";
  if (kind.includes("approval")) return "bg-amber-400";
  if (kind.includes("factuality") || kind.includes("citation")) return "bg-violet-400";
  return "bg-cyan-400";
}

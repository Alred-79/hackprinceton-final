import { useCallback, useEffect, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";
import "./architect.css";
import { CirclePlay, Pause, Play, RefreshCcw, RotateCcw, ShieldAlert } from "lucide-react";
import WorkflowCanvas from "./WorkflowCanvas";
import NodeInspector from "./NodeInspector";
import BlockPalette from "./BlockPalette";
import PreviewTimeline from "./PreviewTimeline";
import { constraintMapEvidence, structuralEvidence } from "@/features/architect/graph";
import { PREVIEW_TRANSITION_MS, startPreviewTransitionDriver, subscribePreviewVisibility } from "@/features/architect/preview";
import type { ArchitectAction, ArchitectState } from "@/features/architect/architectReducer";
import type { PolicyNodeKind } from "@/features/architect/types";

function usePreviewDriver(state: ArchitectState, dispatch: React.Dispatch<ArchitectAction>) {
  const elapsedRef = useRef(state.run.elapsedMs);
  elapsedRef.current = state.run.elapsedMs;
  const status = state.run.status;
  const transitionIndex = state.run.transitionIndex;

  useEffect(() => {
    if (status !== "running") return;
    return startPreviewTransitionDriver(elapsedRef.current, {
      onTick: (elapsedMs) => dispatch({ type: "PREVIEW_TICK", elapsedMs }),
      onComplete: () => dispatch({ type: "COMPLETE_TRANSITION" }),
    });
  }, [dispatch, status, transitionIndex]);

  useEffect(() => {
    return subscribePreviewVisibility(
      () => dispatch({ type: "PAUSE_PREVIEW", byVisibility: true }),
      () => dispatch({ type: "RESUME_PREVIEW", fromVisibility: true }),
    );
  }, [dispatch]);
}

export default function WorkflowResult({
  state,
  dispatch,
}: {
  state: ArchitectState;
  dispatch: React.Dispatch<ArchitectAction>;
}) {
  const graph = state.graph!;
  const evidence = structuralEvidence(graph);
  const constraints = constraintMapEvidence(graph);
  const [selectedPolicyKind, setSelectedPolicyKind] = useState<PolicyNodeKind | null>(null);
  const [draggingPolicyKind, setDraggingPolicyKind] = useState<PolicyNodeKind | null>(null);
  usePreviewDriver(state, dispatch);

  const insertPolicy = useCallback((edgeId: string, kind: PolicyNodeKind) => {
    dispatch({ type: "INSERT_POLICY_ON_SLOT", edgeId, kind });
    setSelectedPolicyKind(null);
    setDraggingPolicyKind(null);
  }, [dispatch]);

  useEffect(() => {
    if (!state.focusTarget) return;
    const element = document.getElementById(state.focusTarget);
    element?.focus();
    dispatch({ type: "CLEAR_FOCUS_TARGET" });
  }, [dispatch, state.focusTarget]);

  const run = state.run;
  const canPause = run.status === "running";
  const canResume = run.status === "paused";
  const currentTransition = run.plan?.transitions[run.transitionIndex];
  const announcement = run.status === "running"
    ? `Preview transition ${run.transitionIndex + 1} running for nodes ${currentTransition?.targetNodeIds.join(", ") ?? "none"} across edges ${currentTransition?.edgeIds.join(", ") ?? "none"}.`
    : run.status === "paused"
      ? `Preview paused at ${Math.round((run.elapsedMs / PREVIEW_TRANSITION_MS) * 100)} percent.`
      : run.status === "complete"
        ? `Preview complete with ${run.timeline.length} symbolic steps.`
        : run.status === "stale"
          ? "Preview evidence is stale because the graph changed."
          : "Preview idle.";

  return (
    <section id="architect-workspace" tabIndex={-1} className="architect-workspace" aria-labelledby="architect-workspace-title">
      <div className="architect-disclosure">
        <div>
          <div className="architect-title-row">
            <h2 id="architect-workspace-title">Local workflow draft</h2>
            <span className={`architect-badge architect-badge--${state.draftStatus}`}>{state.draftStatus}</span>
            {graph.origin === "local_fallback" && (
              <span className="architect-badge architect-badge--fallback"><ShieldAlert size={13} aria-hidden="true" /> Fallback</span>
            )}
          </div>
          <p>This draft maps recognized steps and discloses ambiguity. It is not a proof of execution.</p>
          {state.promptStatus === "description_changed" && (
            <p className="architect-inline-warning">The description changed after this draft was built. Your visible graph and edits are preserved.</p>
          )}
        </div>
        <div className="architect-run-controls">
          <div className="architect-run-actions">
            <button type="button" onClick={() => dispatch({ type: "START_PREVIEW" })} disabled={run.status === "running" || run.status === "paused"}>
              <CirclePlay size={16} aria-hidden="true" /> Run preview
            </button>
            {canPause && (
              <button type="button" onClick={() => dispatch({ type: "PAUSE_PREVIEW" })}>
                <Pause size={16} aria-hidden="true" /> Pause
              </button>
            )}
            {canResume && (
              <button type="button" onClick={() => dispatch({ type: "RESUME_PREVIEW" })}>
                <Play size={16} aria-hidden="true" /> Resume
              </button>
            )}
            <button type="button" onClick={() => dispatch({ type: "RESET_PREVIEW" })} disabled={run.status === "idle"}>
              <RotateCcw size={16} aria-hidden="true" /> Reset
            </button>
            <button type="button" onClick={() => dispatch({ type: "REQUEST_COMPILE" })}>
              <RefreshCcw size={16} aria-hidden="true" /> Reset from description
            </button>
          </div>
          <p className="architect-local-notice">Deterministic local simulation—no external tools are called</p>
        </div>
      </div>

      <details className="architect-notes" open={graph.extractionNotes.length > 0}>
        <summary>Extraction notes ({graph.extractionNotes.length})</summary>
        {graph.extractionNotes.length ? (
          <ul>{graph.extractionNotes.map((note) => <li key={note.id}><strong>{note.kind}:</strong> {note.message}</li>)}</ul>
        ) : <p>No extraction ambiguity was recorded.</p>}
      </details>

      <div className="architect-editor-layout">
        <BlockPalette
          selectedKind={selectedPolicyKind}
          graph={graph}
          onSelect={setSelectedPolicyKind}
          onInsertPolicy={insertPolicy}
          onDragStart={(kind, event) => {
            event.dataTransfer.setData("application/x-architect-policy-block", kind);
            event.dataTransfer.effectAllowed = "copy";
            setDraggingPolicyKind(kind);
          }}
          onDragEnd={() => setDraggingPolicyKind(null)}
        />
        <WorkflowCanvas
          state={state}
          dispatch={dispatch}
          selectedPolicyKind={selectedPolicyKind}
          draggingPolicyKind={draggingPolicyKind}
          onInsertPolicy={insertPolicy}
        />
        <NodeInspector state={state} dispatch={dispatch} />
      </div>

      <PreviewTimeline state={state} />

      <section className="architect-panel architect-evidence" aria-labelledby="architect-evidence-title">
        <div className="architect-panel__heading">
          <div>
            <h3 id="architect-evidence-title">Constraint map</h3>
            <p>Configured decisions and unresolved policy choices in this local draft.</p>
          </div>
        </div>
        <dl className="architect-decision-evidence">
          <div><dt>Schema contracts</dt><dd>{constraints.schemaGateCount}</dd></div>
          <div><dt>Context boundaries</dt><dd>{constraints.contextBoundaryCount}</dd></div>
          <div><dt>Human reviews</dt><dd>{constraints.humanReviewCount}</dd></div>
          <div><dt>Routers</dt><dd>{constraints.routerCount}</dd></div>
          <div><dt>Unresolved policy choices</dt><dd>{constraints.unresolvedDecisionSlotCount}</dd></div>
        </dl>
        <details className="architect-graph-facts">
          <summary>Graph facts</summary>
          <dl>
            <div><dt>Nodes</dt><dd>{evidence.nodeCount}</dd></div>
            <div><dt>Edges</dt><dd>{evidence.edgeCount}</dd></div>
            <div><dt>Critical path</dt><dd>{evidence.criticalPathLength}</dd></div>
          </dl>
        </details>
        <p className="architect-policy-disclaimer">
          Configured policy only; this preview does not enforce live schemas or measure tokens.
        </p>
        <p className="architect-not-measured">
          Task correctness, reliability, real cost/latency, factuality, and live effects are not measured.
        </p>
      </section>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
    </section>
  );
}

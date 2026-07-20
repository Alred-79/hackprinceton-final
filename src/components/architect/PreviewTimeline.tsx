import { Activity, CheckCircle2, Circle, PauseCircle, TriangleAlert } from "lucide-react";
import type { ArchitectState } from "@/features/architect/architectReducer";

export default function PreviewTimeline({ state }: { state: ArchitectState }) {
  const currentTransition = state.run.status === "running" || state.run.status === "paused"
    ? state.run.plan?.transitions[state.run.transitionIndex]
    : undefined;
  const statusIcon = state.run.status === "complete"
    ? <CheckCircle2 size={16} aria-hidden="true" />
    : state.run.status === "paused"
      ? <PauseCircle size={16} aria-hidden="true" />
      : state.run.status === "stale"
        ? <TriangleAlert size={16} aria-hidden="true" />
        : <Circle size={16} aria-hidden="true" />;
  return (
    <section className="architect-panel architect-timeline" aria-labelledby="architect-timeline-title">
      <div className="architect-panel__heading">
        <div>
          <h3 id="architect-timeline-title">Preview timeline</h3>
          <p>Symbolic keys and branch evidence from the deterministic fixture.</p>
        </div>
        <span className={`architect-status architect-status--${state.run.status}`}>
          {statusIcon}<span>{state.run.status}</span>
        </span>
      </div>
      {state.run.status === "stale" && (
        <p className="architect-inline-warning">The graph changed. These retained events are stale; run a new preview to refresh them.</p>
      )}
      {currentTransition && (
        <div className="architect-current-transition" role="status" tabIndex={0} aria-label={`Current transition ${currentTransition.id}`}>
          <div><Activity size={16} aria-hidden="true" /><strong>Current transition</strong></div>
          <p>Nodes: {currentTransition.targetNodeIds.join(", ")}</p>
          <p>Edges: {currentTransition.edgeIds.join(", ")}</p>
          <small>Provenance: {state.run.plan?.fixture.provenance}</small>
        </div>
      )}
      {!state.run.timeline.length ? (
        <div className="architect-empty-timeline">
          <p>No preview events yet.</p>
          <p>Deterministic local simulation—no external tools are called.</p>
        </div>
      ) : (
        <ol className="architect-timeline__list">
          {state.run.timeline.map((event, index) => (
            <li key={event.id}>
              <span className="architect-timeline__index">{index + 1}</span>
              <div>
                <strong>{event.step}</strong>
                <p>Inputs: {event.inputKeys.join(", ") || "none"}</p>
                <p>Outputs: {event.outputKeys.join(", ")}</p>
                {event.selectedRouteId && <p>Route: {event.selectedRouteId}</p>}
                {event.reason && <p>{event.reason}</p>}
                <small>Provenance: {event.provenance}</small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

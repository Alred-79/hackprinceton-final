import { canonicalArchitectJson } from "./graph";
import type { ArchitectEdge, ArchitectGraph, ArchitectNode, RouterConfig } from "./types";

export const PREVIEW_TRANSITION_MS = 600;

export interface PreviewAnimationScheduler {
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
}

export function startPreviewTransitionDriver(
  startingElapsedMs: number,
  callbacks: { onTick: (elapsedMs: number) => void; onComplete: () => void },
  scheduler: PreviewAnimationScheduler = {
    now: () => performance.now(),
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  },
): () => void {
  const startedAt = scheduler.now();
  let frame = 0;
  let cancelled = false;
  const tick: FrameRequestCallback = (now) => {
    if (cancelled) return;
    const elapsed = Math.min(PREVIEW_TRANSITION_MS, Math.max(0, startingElapsedMs + now - startedAt));
    callbacks.onTick(elapsed);
    if (elapsed >= PREVIEW_TRANSITION_MS) {
      callbacks.onComplete();
      return;
    }
    frame = scheduler.request(tick);
  };
  frame = scheduler.request(tick);
  return () => {
    cancelled = true;
    scheduler.cancel(frame);
  };
}

export function subscribePreviewVisibility(
  onHidden: () => void,
  onVisible: () => void,
  documentTarget: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document,
): () => void {
  const listener = () => documentTarget.hidden ? onHidden() : onVisible();
  documentTarget.addEventListener("visibilitychange", listener);
  return () => documentTarget.removeEventListener("visibilitychange", listener);
}

export interface DeterministicFixture {
  descriptionSnapshotId: string;
  fixture: {
    numericValue: number;
    booleanFlag: boolean;
  };
  provenance: "deterministic_fixture";
}

export interface PreviewTimelineEvent {
  id: string;
  nodeId: string;
  edgeIds: string[];
  step: string;
  inputKeys: string[];
  outputKeys: string[];
  provenance: "deterministic_fixture";
  selectedRouteId?: string;
  reason?: string;
}

export interface PreviewTransition {
  id: string;
  edgeIds: string[];
  targetNodeIds: string[];
  events: PreviewTimelineEvent[];
}

export interface PreviewPlan {
  runId: string;
  fixture: DeterministicFixture;
  reachedNodeIds: string[];
  skippedNodeIds: string[];
  traversedEdgeIds: string[];
  skippedEdgeIds: string[];
  transitions: PreviewTransition[];
  initialEvents: PreviewTimelineEvent[];
}

export interface RouterDecision {
  selectedRouteId: string;
  reason: string;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evaluateRouter(config: RouterConfig, fixture: DeterministicFixture): RouterDecision {
  if (config.operand === "unsupported" || config.operator === "default") {
    return {
      selectedRouteId: config.defaultRouteId,
      reason: `Unsupported condition “${config.displayCondition}”; selected named default route ${config.defaultRouteId}.`,
    };
  }
  const value = config.operand === "fixture.numericValue"
    ? fixture.fixture.numericValue
    : fixture.fixture.booleanFlag;
  let matched = false;
  switch (config.operator) {
    case ">": matched = Number(value) > Number(config.comparisonValue); break;
    case ">=": matched = Number(value) >= Number(config.comparisonValue); break;
    case "<": matched = Number(value) < Number(config.comparisonValue); break;
    case "<=": matched = Number(value) <= Number(config.comparisonValue); break;
    case "==": matched = value === config.comparisonValue; break;
    case "!=": matched = value !== config.comparisonValue; break;
    case "truthy": matched = Boolean(value); break;
    case "falsy": matched = !value; break;
  }
  const selectedRouteId = matched ? config.conditionRouteId : config.defaultRouteId;
  return {
    selectedRouteId,
    reason: `${config.operand} (${String(value)}) ${config.operator}${config.comparisonValue === undefined ? "" : ` ${String(config.comparisonValue)}`} evaluated ${matched}; selected ${selectedRouteId}.`,
  };
}

function symbolicEvent(
  node: ArchitectNode,
  edgeIds: string[],
  incoming: ArchitectEdge[],
  routerDecision?: RouterDecision,
): PreviewTimelineEvent {
  const action = node.config.type === "action"
    ? `${node.config.actionKind.replace(/_/g, "-")} step simulated`
    : node.kind === "router"
      ? "Guard evaluated against deterministic fixture"
      : node.kind === "evaluator"
        ? "Evaluator step simulated"
        : node.kind === "human_review"
          ? "Human-review checkpoint represented; no approval was requested"
          : node.config.type === "schema_gate"
            ? `Schema contract configured (${node.config.contractName}, ${node.config.mode}); symbolic only—no live schema validation`
            : node.config.type === "context_gate"
              ? `Context boundary configured (${node.config.tokenCap} fixture symbolic units, ${node.config.strategy}); no token usage measured`
              : node.kind === "input"
                ? "Deterministic fixture prepared"
                : "Output envelope assembled";
  return {
    id: `event-${node.id}`,
    nodeId: node.id,
    edgeIds,
    step: `${node.label}: ${action}`,
    inputKeys: node.kind === "input"
      ? ["descriptionSnapshotId", "fixture.numericValue", "fixture.booleanFlag"]
      : incoming.map((edge) => `step.${edge.source}`).sort(),
    outputKeys: node.kind === "output" ? ["preview.output"] : [`step.${node.id}`],
    provenance: "deterministic_fixture",
    ...(routerDecision ? {
      selectedRouteId: routerDecision.selectedRouteId,
      reason: routerDecision.reason,
    } : {}),
  };
}

export function planPreview(
  graph: ArchitectGraph,
  fixtureValues: Partial<DeterministicFixture["fixture"]> = {},
): PreviewPlan {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as ArchitectEdge[]]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as ArchitectEdge[]]));
  for (const edge of graph.edges) {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }
  for (const edges of outgoing.values()) edges.sort((a, b) => a.id.localeCompare(b.id));
  const canonical = canonicalArchitectJson(graph);
  const fixture: DeterministicFixture = {
    descriptionSnapshotId: stableHash(graph.descriptionSnapshot),
    fixture: {
      numericValue: fixtureValues.numericValue ?? 0,
      booleanFlag: fixtureValues.booleanFlag ?? false,
    },
    provenance: "deterministic_fixture",
  };
  const input = graph.nodes.find((node) => node.kind === "input")!;
  const reached = new Set<string>();
  const activeEdges = new Set<string>();
  const decisions = new Map<string, RouterDecision>();
  const pending = [input.id];
  while (pending.length) {
    const nodeId = pending.shift()!;
    if (reached.has(nodeId)) continue;
    reached.add(nodeId);
    const node = nodes.get(nodeId)!;
    let selected = outgoing.get(nodeId) ?? [];
    if (node.config.type === "router") {
      const decision = evaluateRouter(node.config, fixture);
      decisions.set(nodeId, decision);
      selected = selected.filter((edge) => edge.sourceHandle === decision.selectedRouteId);
    }
    for (const edge of selected) {
      activeEdges.add(edge.id);
      pending.push(edge.target);
    }
  }

  const reachedIncoming = new Map<string, ArchitectEdge[]>();
  for (const nodeId of reached) {
    reachedIncoming.set(nodeId, (incoming.get(nodeId) ?? []).filter((edge) => activeEdges.has(edge.id)));
  }
  const completed = new Set<string>([input.id]);
  const transitions: PreviewTransition[] = [];
  while (completed.size < reached.size) {
    const ready = [...reached]
      .filter((id) => !completed.has(id))
      .filter((id) => (reachedIncoming.get(id) ?? []).every((edge) => completed.has(edge.source)))
      .sort();
    if (!ready.length) break;
    const transitionEdges = ready
      .flatMap((id) => reachedIncoming.get(id) ?? [])
      .sort((a, b) => a.id.localeCompare(b.id));
    transitions.push({
      id: `transition-${transitions.length + 1}`,
      edgeIds: transitionEdges.map((edge) => edge.id),
      targetNodeIds: ready,
      events: ready.map((id) => {
        const node = nodes.get(id)!;
        return symbolicEvent(node, (reachedIncoming.get(id) ?? []).map((edge) => edge.id).sort(), reachedIncoming.get(id) ?? [], decisions.get(id));
      }),
    });
    ready.forEach((id) => completed.add(id));
  }
  return {
    runId: `local-${stableHash(canonical)}`,
    fixture,
    reachedNodeIds: [...reached].sort(),
    skippedNodeIds: graph.nodes.map((node) => node.id).filter((id) => !reached.has(id)).sort(),
    traversedEdgeIds: [...activeEdges].sort(),
    skippedEdgeIds: graph.edges.map((edge) => edge.id).filter((id) => !activeEdges.has(id)).sort(),
    transitions,
    initialEvents: [symbolicEvent(input, [], [], decisions.get(input.id))],
  };
}

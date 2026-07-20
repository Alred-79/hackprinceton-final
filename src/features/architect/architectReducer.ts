import { compileDescription } from "./compiler";
import { cloneGraph, validateArchitectGraph } from "./graph";
import { derivePolicySlots, POLICY_BLOCK_META } from "./policySlots";
import { planPreview, PREVIEW_TRANSITION_MS, type PreviewPlan, type PreviewTimelineEvent } from "./preview";
import { ARCHITECT_NODE_LIMIT } from "./types";
import type {
  ActionKind,
  ArchitectEdge,
  ArchitectGraph,
  ArchitectNode,
  PolicyNodeKind,
  RouterConfig,
} from "./types";

export type PromptStatus = "empty" | "ready" | "description_changed";
export type DraftStatus = "none" | "clean" | "dirty" | "fallback";
export type RunStatus = "idle" | "running" | "paused" | "complete" | "stale";

export interface EditorCounters {
  node: number;
  edge: number;
  route: number;
}

export interface ArchitectRunState {
  status: RunStatus;
  plan: PreviewPlan | null;
  transitionIndex: number;
  elapsedMs: number;
  traversedEdgeIds: string[];
  completedNodeIds: string[];
  timeline: PreviewTimelineEvent[];
  pausedByVisibility: boolean;
}

export interface ArchitectState {
  prompt: string;
  promptStatus: PromptStatus;
  graph: ArchitectGraph | null;
  draftStatus: DraftStatus;
  counters: EditorCounters;
  run: ArchitectRunState;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  editError: string | null;
  focusTarget: string | null;
  replacementPending: boolean;
}

export type InsertableKind = "action" | "evaluator" | "human_review";

export interface InsertNodeSpec {
  kind: InsertableKind | "schema_gate" | "context_gate";
  label: string;
  actionKind?: ActionKind;
  operationVerb?: string;
}

export interface RouterSpec {
  label: string;
  displayCondition: string;
  operand?: RouterConfig["operand"];
  operator?: RouterConfig["operator"];
  comparisonValue?: RouterConfig["comparisonValue"];
  conditionLabel?: string;
  defaultLabel?: string;
}

export type ArchitectAction =
  | { type: "SET_PROMPT"; prompt: string }
  | { type: "REQUEST_COMPILE" }
  | { type: "CONFIRM_REPLACE" }
  | { type: "CANCEL_REPLACE" }
  | { type: "SELECT_NODE"; nodeId: string | null }
  | { type: "SELECT_EDGE"; edgeId: string | null }
  | { type: "CLEAR_FOCUS_TARGET" }
  | { type: "MOVE_NODE"; nodeId: string; position: { x: number; y: number } }
  | { type: "RENAME_NODE"; nodeId: string; label: string }
  | { type: "UPDATE_NODE_CONFIG"; nodeId: string; config: ArchitectNode["config"] }
  | { type: "INSERT_NODE_ON_EDGE"; edgeId: string; spec: InsertNodeSpec }
  | { type: "INSERT_POLICY_ON_SLOT"; edgeId: string; kind: PolicyNodeKind }
  | { type: "INSERT_ROUTER_ON_EDGE"; edgeId: string; spec: RouterSpec }
  | { type: "DELETE_LINEAR_NODE"; nodeId: string }
  | { type: "RENAME_ROUTE_ID"; routerId: string; oldId: string; newId: string }
  | { type: "RENAME_ROUTE_LABEL"; routerId: string; routeId: string; label: string }
  | { type: "SWAP_DEFAULT_ROUTE"; routerId: string; routeId: string }
  | { type: "CONNECT"; connection: Omit<ArchitectEdge, "id"> }
  | { type: "RECONNECT_EDGE"; edgeId: string; target: string; targetHandle?: string }
  | { type: "DISCONNECT"; edgeId: string }
  | { type: "START_PREVIEW" }
  | { type: "PREVIEW_TICK"; elapsedMs: number }
  | { type: "COMPLETE_TRANSITION" }
  | { type: "PAUSE_PREVIEW"; byVisibility?: boolean }
  | { type: "RESUME_PREVIEW"; fromVisibility?: boolean }
  | { type: "RESET_PREVIEW" };

const idleRun = (): ArchitectRunState => ({
  status: "idle",
  plan: null,
  transitionIndex: 0,
  elapsedMs: 0,
  traversedEdgeIds: [],
  completedNodeIds: [],
  timeline: [],
  pausedByVisibility: false,
});

export function createArchitectState(): ArchitectState {
  return {
    prompt: "",
    promptStatus: "empty",
    graph: null,
    draftStatus: "none",
    counters: { node: 1, edge: 1, route: 1 },
    run: idleRun(),
    selectedNodeId: null,
    selectedEdgeId: null,
    editError: null,
    focusTarget: null,
    replacementPending: false,
  };
}

function nextOrdinal(ids: string[], prefix: string): number {
  return Math.max(0, ...ids.map((id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Number(match[1]) : 0;
  })) + 1;
}

export function initializeEditorCounters(graph: ArchitectGraph): EditorCounters {
  const routeIds = graph.nodes.flatMap((node) => node.config.type === "router" ? node.config.routes.map((route) => route.id) : []);
  return {
    node: nextOrdinal(graph.nodes.map((node) => node.id), "editor-node"),
    edge: nextOrdinal(graph.edges.map((edge) => edge.id), "editor-edge"),
    route: nextOrdinal(routeIds, "editor-route"),
  };
}

interface TransactionSuccess {
  ok: true;
  graph: ArchitectGraph;
  counters: EditorCounters;
  focusTarget?: string;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
}

interface TransactionFailure {
  ok: false;
  error: string;
}

export type TransactionResult = TransactionSuccess | TransactionFailure;

function reject(message: string): TransactionFailure {
  return { ok: false, error: message };
}

function commit(graph: ArchitectGraph, counters: EditorCounters, additions: Omit<TransactionSuccess, "ok" | "graph" | "counters"> = {}): TransactionResult {
  const validation = validateArchitectGraph(graph);
  if (!validation.valid) return reject(validation.errors[0] ?? "The edit would make the graph invalid.");
  return { ok: true, graph, counters, ...additions };
}

function nodeConfig(spec: InsertNodeSpec): ArchitectNode["config"] {
  if (spec.kind === "action") {
    return {
      type: "action",
      actionKind: spec.actionKind ?? "reasoning",
      operationVerb: spec.operationVerb?.trim().slice(0, 80) || "edit",
      simulated: true,
    };
  }
  if (spec.kind === "evaluator") return { type: "evaluator", criterion: spec.label };
  if (spec.kind === "human_review") return { type: "human_review", instruction: spec.label };
  if (spec.kind === "schema_gate") {
    return {
      type: "schema_gate",
      contractName: "OutputContract",
      mode: "strict",
      requiredFields: ["result"],
      violationBehavior: "stop",
    };
  }
  return {
    type: "context_gate",
    tokenCap: 4_000,
    strategy: "select",
    allowedSources: ["workflow input"],
    blockedFields: [],
  };
}

export function insertNodeOnEdge(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  edgeId: string,
  spec: InsertNodeSpec,
): TransactionResult {
  const graph = cloneGraph(sourceGraph);
  const edgeIndex = graph.edges.findIndex((edge) => edge.id === edgeId);
  if (edgeIndex < 0) return reject(`Edge ${edgeId} was not found.`);
  const old = graph.edges[edgeIndex];
  const source = graph.nodes.find((node) => node.id === old.source)!;
  const target = graph.nodes.find((node) => node.id === old.target)!;
  const counters = { ...sourceCounters };
  const nodeId = `editor-node-${counters.node++}`;
  const node: ArchitectNode = {
    id: nodeId,
    kind: spec.kind,
    label: spec.label.trim().slice(0, 180) || "Simulated step",
    config: nodeConfig(spec),
    position: { x: (source.position.x + target.position.x) / 2, y: (source.position.y + target.position.y) / 2 },
  };
  const first: ArchitectEdge = {
    id: `editor-edge-${counters.edge++}`,
    source: old.source,
    target: nodeId,
    ...(old.sourceHandle ? { sourceHandle: old.sourceHandle } : {}),
  };
  const second: ArchitectEdge = {
    id: `editor-edge-${counters.edge++}`,
    source: nodeId,
    target: old.target,
    ...(old.targetHandle ? { targetHandle: old.targetHandle } : {}),
  };
  graph.edges.splice(edgeIndex, 1, first, second);
  graph.nodes.push(node);
  return commit(graph, counters, { focusTarget: `node-${nodeId}`, selectedNodeId: nodeId, selectedEdgeId: null });
}

export function insertPolicyNodeOnEdge(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  edgeId: string,
  kind: PolicyNodeKind,
): TransactionResult {
  const slot = derivePolicySlots(sourceGraph).find((candidate) => candidate.edgeId === edgeId);
  if (!slot) return reject(`Edge ${edgeId} does not expose an open policy slot.`);
  if (!slot.compatibleKinds.includes(kind)) {
    return reject(`${POLICY_BLOCK_META[kind].label} is not compatible with this policy slot.`);
  }
  if (sourceGraph.nodes.length >= ARCHITECT_NODE_LIMIT) {
    return reject(`This draft already contains ${ARCHITECT_NODE_LIMIT} nodes; remove a linear node before filling another policy slot.`);
  }
  return insertNodeOnEdge(sourceGraph, sourceCounters, edgeId, {
    kind,
    label: POLICY_BLOCK_META[kind].label,
  });
}

export function updateNodeConfig(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  nodeId: string,
  config: ArchitectNode["config"],
): TransactionResult {
  const graph = cloneGraph(sourceGraph);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return reject(`Node ${nodeId} was not found.`);
  node.config = structuredClone(config);
  return commit(graph, { ...sourceCounters }, { selectedNodeId: nodeId });
}

export function insertRouterOnEdge(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  edgeId: string,
  spec: RouterSpec,
): TransactionResult {
  const graph = cloneGraph(sourceGraph);
  const edgeIndex = graph.edges.findIndex((edge) => edge.id === edgeId);
  if (edgeIndex < 0) return reject(`Edge ${edgeId} was not found.`);
  const old = graph.edges[edgeIndex];
  const source = graph.nodes.find((node) => node.id === old.source)!;
  const target = graph.nodes.find((node) => node.id === old.target)!;
  const counters = { ...sourceCounters };
  const nodeId = `editor-node-${counters.node++}`;
  const conditionRouteId = `editor-route-${counters.route++}`;
  const defaultRouteId = `editor-route-${counters.route++}`;
  const operand = spec.operand ?? "unsupported";
  const operator = spec.operator ?? "default";
  const router: ArchitectNode = {
    id: nodeId,
    kind: "router",
    label: spec.label.trim().slice(0, 180) || "Guarded branch",
    position: { x: (source.position.x + target.position.x) / 2, y: (source.position.y + target.position.y) / 2 },
    config: {
      type: "router",
      displayCondition: spec.displayCondition.trim().slice(0, 240) || "Unsupported edited condition",
      operand,
      operator,
      ...(spec.comparisonValue === undefined ? {} : { comparisonValue: spec.comparisonValue }),
      routes: [
        { id: conditionRouteId, label: spec.conditionLabel?.trim().slice(0, 180) || "Condition", role: "condition" },
        { id: defaultRouteId, label: spec.defaultLabel?.trim().slice(0, 180) || "Default", role: "default" },
      ],
      conditionRouteId,
      defaultRouteId,
    },
  };
  const predecessor: ArchitectEdge = {
    id: `editor-edge-${counters.edge++}`,
    source: old.source,
    target: nodeId,
    ...(old.sourceHandle ? { sourceHandle: old.sourceHandle } : {}),
  };
  const condition: ArchitectEdge = {
    id: `editor-edge-${counters.edge++}`,
    source: nodeId,
    sourceHandle: conditionRouteId,
    target: old.target,
    ...(old.targetHandle ? { targetHandle: old.targetHandle } : {}),
  };
  const fallback: ArchitectEdge = {
    id: `editor-edge-${counters.edge++}`,
    source: nodeId,
    sourceHandle: defaultRouteId,
    target: old.target,
    ...(old.targetHandle ? { targetHandle: old.targetHandle } : {}),
  };
  graph.edges.splice(edgeIndex, 1, predecessor, condition, fallback);
  graph.nodes.push(router);
  return commit(graph, counters, { focusTarget: `node-${nodeId}`, selectedNodeId: nodeId, selectedEdgeId: null });
}

export function deleteLinearNode(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  nodeId: string,
): TransactionResult {
  const graph = cloneGraph(sourceGraph);
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return reject(`Node ${nodeId} was not found.`);
  if (node.kind === "input" || node.kind === "output") return reject("Input and output nodes are compiler-owned and cannot be deleted.");
  if (node.kind === "router") return reject("Routers cannot be deleted in Pass 1; insert or edit a route instead.");
  const incoming = graph.edges.filter((edge) => edge.target === nodeId);
  const outgoing = graph.edges.filter((edge) => edge.source === nodeId);
  if (incoming.length !== 1 || outgoing.length !== 1) return reject("Only a one-in/one-out linear node can be deleted.");
  const before = incoming[0];
  const after = outgoing[0];
  const proposedTuple = [before.source, before.sourceHandle ?? "", after.target, after.targetHandle ?? ""].join("|");
  if (graph.edges.some((edge) => edge.id !== before.id && edge.id !== after.id
    && [edge.source, edge.sourceHandle ?? "", edge.target, edge.targetHandle ?? ""].join("|") === proposedTuple)) {
    return reject("Deleting this node would create a duplicate splice.");
  }
  const counters = { ...sourceCounters };
  const replacement: ArchitectEdge = {
    id: `editor-edge-${counters.edge++}`,
    source: before.source,
    target: after.target,
    ...(before.sourceHandle ? { sourceHandle: before.sourceHandle } : {}),
    ...(after.targetHandle ? { targetHandle: after.targetHandle } : {}),
  };
  graph.nodes = graph.nodes.filter((candidate) => candidate.id !== nodeId);
  graph.edges = graph.edges.filter((edge) => edge.id !== before.id && edge.id !== after.id);
  graph.edges.push(replacement);
  const next = graph.nodes.find((candidate) => candidate.kind !== "input")?.id;
  return commit(graph, counters, { focusTarget: next ? `node-${next}` : "architect-insert-controls", selectedNodeId: next ?? null });
}

export function renameRouteId(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  routerId: string,
  oldId: string,
  newIdValue: string,
): TransactionResult {
  const newId = newIdValue.trim();
  if (!newId || newId.length > 120) return reject("Route IDs must contain 1–120 characters.");
  const graph = cloneGraph(sourceGraph);
  const router = graph.nodes.find((node) => node.id === routerId && node.config.type === "router");
  if (!router || router.config.type !== "router") return reject(`Router ${routerId} was not found.`);
  if (!router.config.routes.some((route) => route.id === oldId)) return reject(`Route ${oldId} was not found.`);
  if (router.config.routes.some((route) => route.id === newId && route.id !== oldId)) return reject(`Route ID ${newId} is already used by this router.`);
  router.config.routes = router.config.routes.map((route) => route.id === oldId ? { ...route, id: newId } : route) as RouterConfig["routes"];
  if (router.config.conditionRouteId === oldId) router.config.conditionRouteId = newId;
  if (router.config.defaultRouteId === oldId) router.config.defaultRouteId = newId;
  graph.edges = graph.edges.map((edge) => edge.source === routerId && edge.sourceHandle === oldId
    ? { ...edge, sourceHandle: newId }
    : edge);
  return commit(graph, { ...sourceCounters }, { focusTarget: `route-${newId}`, selectedNodeId: routerId });
}

export function swapDefaultRoute(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  routerId: string,
  routeId: string,
): TransactionResult {
  const graph = cloneGraph(sourceGraph);
  const router = graph.nodes.find((node) => node.id === routerId && node.config.type === "router");
  if (!router || router.config.type !== "router") return reject(`Router ${routerId} was not found.`);
  if (!router.config.routes.some((route) => route.id === routeId)) return reject(`Route ${routeId} was not found.`);
  if (router.config.defaultRouteId === routeId) return commit(graph, { ...sourceCounters });
  router.config.routes = router.config.routes.map((route) => ({
    ...route,
    role: route.id === routeId ? "default" : "condition",
  })) as RouterConfig["routes"];
  router.config.defaultRouteId = routeId;
  router.config.conditionRouteId = router.config.routes.find((route) => route.id !== routeId)!.id;
  return commit(graph, { ...sourceCounters }, { focusTarget: `route-${routeId}`, selectedNodeId: routerId });
}

export function reconnectEdge(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  edgeId: string,
  target: string,
  targetHandle?: string,
): TransactionResult {
  const graph = cloneGraph(sourceGraph);
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return reject(`Edge ${edgeId} was not found.`);
  edge.target = target;
  if (targetHandle) edge.targetHandle = targetHandle;
  else delete edge.targetHandle;
  return commit(graph, { ...sourceCounters }, { selectedEdgeId: edgeId, focusTarget: "architect-reconnect-edge" });
}

function simpleGraphEdit(
  sourceGraph: ArchitectGraph,
  sourceCounters: EditorCounters,
  mutate: (graph: ArchitectGraph, counters: EditorCounters) => void,
): TransactionResult {
  const graph = cloneGraph(sourceGraph);
  const counters = { ...sourceCounters };
  mutate(graph, counters);
  return commit(graph, counters);
}

function staleRun(run: ArchitectRunState): ArchitectRunState {
  if (run.status === "idle") return run;
  return { ...run, status: "stale", elapsedMs: 0, pausedByVisibility: false };
}

function applyTransaction(state: ArchitectState, result: TransactionResult): ArchitectState {
  if ("error" in result) {
    return { ...state, editError: result.error, focusTarget: "architect-edit-error" };
  }
  return {
    ...state,
    graph: result.graph,
    counters: result.counters,
    draftStatus: "dirty",
    run: staleRun(state.run),
    editError: null,
    focusTarget: result.focusTarget ?? null,
    selectedNodeId: result.selectedNodeId === undefined ? state.selectedNodeId : result.selectedNodeId,
    selectedEdgeId: result.selectedEdgeId === undefined ? state.selectedEdgeId : result.selectedEdgeId,
  };
}

function compileState(state: ArchitectState): ArchitectState {
  const graph = compileDescription(state.prompt);
  return {
    ...state,
    graph,
    promptStatus: state.prompt.trim() ? "ready" : "empty",
    draftStatus: graph.origin === "local_fallback" ? "fallback" : "clean",
    counters: initializeEditorCounters(graph),
    run: idleRun(),
    selectedNodeId: graph.nodes[0]?.id ?? null,
    selectedEdgeId: null,
    editError: null,
    focusTarget: "architect-workspace",
    replacementPending: false,
  };
}

export function architectReducer(state: ArchitectState, action: ArchitectAction): ArchitectState {
  switch (action.type) {
    case "SET_PROMPT": {
      const prompt = action.prompt.slice(0, 8_000);
      return {
        ...state,
        prompt,
        promptStatus: !prompt.trim()
          ? "empty"
          : state.graph && prompt !== state.graph.descriptionSnapshot
            ? "description_changed"
            : "ready",
      };
    }
    case "REQUEST_COMPILE":
      if (!state.prompt.trim()) return state;
      if (state.graph && state.draftStatus === "dirty") return { ...state, replacementPending: true };
      return compileState(state);
    case "CONFIRM_REPLACE":
      return compileState(state);
    case "CANCEL_REPLACE":
      return { ...state, replacementPending: false };
    case "SELECT_NODE":
      return { ...state, selectedNodeId: action.nodeId, selectedEdgeId: null };
    case "SELECT_EDGE":
      return { ...state, selectedEdgeId: action.edgeId, selectedNodeId: null };
    case "CLEAR_FOCUS_TARGET":
      return { ...state, focusTarget: null };
    case "MOVE_NODE":
      if (!state.graph || !Number.isFinite(action.position.x) || !Number.isFinite(action.position.y)) return state;
      return applyTransaction(state, simpleGraphEdit(state.graph, state.counters, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === action.nodeId);
        if (node) node.position = action.position;
      }));
    case "RENAME_NODE":
      if (!state.graph) return state;
      return applyTransaction(state, simpleGraphEdit(state.graph, state.counters, (graph) => {
        const node = graph.nodes.find((candidate) => candidate.id === action.nodeId);
        if (node) node.label = action.label.trim().slice(0, 180);
      }));
    case "UPDATE_NODE_CONFIG":
      return state.graph
        ? applyTransaction(state, updateNodeConfig(state.graph, state.counters, action.nodeId, action.config))
        : state;
    case "INSERT_NODE_ON_EDGE":
      return state.graph ? applyTransaction(state, insertNodeOnEdge(state.graph, state.counters, action.edgeId, action.spec)) : state;
    case "INSERT_POLICY_ON_SLOT":
      return state.graph
        ? applyTransaction(state, insertPolicyNodeOnEdge(state.graph, state.counters, action.edgeId, action.kind))
        : state;
    case "INSERT_ROUTER_ON_EDGE":
      return state.graph ? applyTransaction(state, insertRouterOnEdge(state.graph, state.counters, action.edgeId, action.spec)) : state;
    case "DELETE_LINEAR_NODE":
      return state.graph ? applyTransaction(state, deleteLinearNode(state.graph, state.counters, action.nodeId)) : state;
    case "RENAME_ROUTE_ID":
      return state.graph ? applyTransaction(state, renameRouteId(state.graph, state.counters, action.routerId, action.oldId, action.newId)) : state;
    case "RENAME_ROUTE_LABEL":
      if (!state.graph) return state;
      return applyTransaction(state, simpleGraphEdit(state.graph, state.counters, (graph) => {
        const router = graph.nodes.find((node) => node.id === action.routerId);
        if (router?.config.type === "router") {
          router.config.routes = router.config.routes.map((route) => route.id === action.routeId
            ? { ...route, label: action.label.trim().slice(0, 180) }
            : route) as RouterConfig["routes"];
        }
      }));
    case "SWAP_DEFAULT_ROUTE":
      return state.graph ? applyTransaction(state, swapDefaultRoute(state.graph, state.counters, action.routerId, action.routeId)) : state;
    case "CONNECT":
      if (!state.graph) return state;
      return applyTransaction(state, simpleGraphEdit(state.graph, state.counters, (graph, counters) => {
        graph.edges.push({ id: `editor-edge-${counters.edge++}`, ...action.connection });
      }));
    case "RECONNECT_EDGE":
      return state.graph
        ? applyTransaction(state, reconnectEdge(state.graph, state.counters, action.edgeId, action.target, action.targetHandle))
        : state;
    case "DISCONNECT":
      if (!state.graph) return state;
      return applyTransaction(state, simpleGraphEdit(state.graph, state.counters, (graph) => {
        graph.edges = graph.edges.filter((edge) => edge.id !== action.edgeId);
      }));
    case "START_PREVIEW": {
      if (!state.graph) return state;
      const plan = planPreview(state.graph);
      return {
        ...state,
        run: {
          status: plan.transitions.length ? "running" : "complete",
          plan,
          transitionIndex: 0,
          elapsedMs: 0,
          traversedEdgeIds: [],
          completedNodeIds: [state.graph.nodes.find((node) => node.kind === "input")!.id],
          timeline: plan.initialEvents,
          pausedByVisibility: false,
        },
      };
    }
    case "PREVIEW_TICK":
      if (state.run.status !== "running") return state;
      return { ...state, run: { ...state.run, elapsedMs: Math.min(PREVIEW_TRANSITION_MS, Math.max(0, action.elapsedMs)) } };
    case "COMPLETE_TRANSITION": {
      if (state.run.status !== "running" || !state.run.plan) return state;
      const transition = state.run.plan.transitions[state.run.transitionIndex];
      if (!transition) return { ...state, run: { ...state.run, status: "complete", elapsedMs: 0 } };
      const nextIndex = state.run.transitionIndex + 1;
      return {
        ...state,
        run: {
          ...state.run,
          status: nextIndex >= state.run.plan.transitions.length ? "complete" : "running",
          transitionIndex: nextIndex,
          elapsedMs: 0,
          traversedEdgeIds: [...new Set([...state.run.traversedEdgeIds, ...transition.edgeIds])].sort(),
          completedNodeIds: [...new Set([...state.run.completedNodeIds, ...transition.targetNodeIds])].sort(),
          timeline: [...state.run.timeline, ...transition.events],
        },
      };
    }
    case "PAUSE_PREVIEW":
      if (state.run.status !== "running") return state;
      return { ...state, run: { ...state.run, status: "paused", pausedByVisibility: Boolean(action.byVisibility) } };
    case "RESUME_PREVIEW":
      if (state.run.status !== "paused") return state;
      if (action.fromVisibility && !state.run.pausedByVisibility) return state;
      return { ...state, run: { ...state.run, status: "running", pausedByVisibility: false } };
    case "RESET_PREVIEW":
      return { ...state, run: idleRun() };
    default:
      return state;
  }
}

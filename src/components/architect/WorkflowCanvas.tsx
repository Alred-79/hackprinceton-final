import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import ArchitectEdge, { type ArchitectFlowEdge } from "./ArchitectEdge";
import ArchitectNode, { type ArchitectFlowNode } from "./ArchitectNode";
import type { ArchitectAction, ArchitectState } from "@/features/architect/architectReducer";
import { derivePolicySlots, selectPolicySlotsForPresentation } from "@/features/architect/policySlots";
import { ARCHITECT_NODE_LIMIT, type PolicyNodeKind } from "@/features/architect/types";

export const ARCHITECT_READABLE_MIN_ZOOM = 0.7;

const nodeTypes = { architectNode: ArchitectNode };
const edgeTypes = { architectEdge: ArchitectEdge };

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export default function WorkflowCanvas({
  state,
  dispatch,
  selectedPolicyKind,
  draggingPolicyKind,
  onInsertPolicy,
}: {
  state: ArchitectState;
  dispatch: React.Dispatch<ArchitectAction>;
  selectedPolicyKind: PolicyNodeKind | null;
  draggingPolicyKind: PolicyNodeKind | null;
  onInsertPolicy: (edgeId: string, kind: PolicyNodeKind) => void;
}) {
  const graph = state.graph!;
  const reducedMotion = useReducedMotion();
  const transition = state.run.plan?.transitions[state.run.transitionIndex];
  const activeEdgeIds = useMemo(() => (
    state.run.status === "running" || state.run.status === "paused"
      ? transition?.edgeIds ?? []
      : []
  ), [state.run.status, transition]);
  const dotEdgeIds = useMemo(() => new Set([...activeEdgeIds].sort().slice(0, 4)), [activeEdgeIds]);
  const skippedNodes = useMemo(() => new Set(state.run.plan?.skippedNodeIds ?? []), [state.run.plan]);
  const skippedEdges = useMemo(() => new Set(state.run.plan?.skippedEdgeIds ?? []), [state.run.plan]);
  const traversedEdges = useMemo(() => new Set(state.run.traversedEdgeIds), [state.run.traversedEdgeIds]);
  const completedNodes = useMemo(() => new Set(state.run.completedNodeIds), [state.run.completedNodeIds]);
  const activeTargets = useMemo(() => new Set(transition?.targetNodeIds ?? []), [transition]);
  const previewVisible = state.run.status !== "idle";
  const capacityReached = graph.nodes.length >= ARCHITECT_NODE_LIMIT;
  const slotByEdge = useMemo(() => new Map(
    selectPolicySlotsForPresentation(derivePolicySlots(graph)).map((slot) => [slot.edgeId, slot]),
  ), [graph]);

  const nodes = useMemo<ArchitectFlowNode[]>(() => graph.nodes.map((node) => ({
    id: node.id,
    type: "architectNode",
    position: node.position,
    selected: node.id === state.selectedNodeId,
    data: {
      model: node,
      previewVisible,
      status: activeTargets.has(node.id)
        ? "active"
        : completedNodes.has(node.id)
          ? "traversed"
          : skippedNodes.has(node.id)
            ? "skipped"
            : "idle",
    },
  })), [graph.nodes, state.selectedNodeId, previewVisible, activeTargets, completedNodes, skippedNodes]);

  const edges = useMemo<ArchitectFlowEdge[]>(() => graph.edges.map((edge) => ({
    ...edge,
    type: "architectEdge",
    selected: edge.id === state.selectedEdgeId,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    data: {
      status: activeEdgeIds.includes(edge.id)
        ? "active"
        : traversedEdges.has(edge.id)
          ? "traversed"
          : skippedEdges.has(edge.id)
            ? "skipped"
            : "idle",
      progress: state.run.elapsedMs / 600,
      renderDot: !reducedMotion && activeEdgeIds.includes(edge.id) && dotEdgeIds.has(edge.id),
      previewVisible,
      slot: slotByEdge.get(edge.id),
      selectedPolicyKind,
      draggingPolicyKind,
      capacityReached,
      onInsertPolicy,
    },
  })), [graph.edges, state.selectedEdgeId, activeEdgeIds, traversedEdges, skippedEdges, state.run.elapsedMs, reducedMotion, dotEdgeIds, previewVisible, slotByEdge, selectedPolicyKind, draggingPolicyKind, capacityReached, onInsertPolicy]);

  function onNodesChange(changes: NodeChange<ArchitectFlowNode>[]) {
    for (const change of changes) {
      if (change.type === "select") dispatch({ type: "SELECT_NODE", nodeId: change.selected ? change.id : null });
    }
  }

  function onEdgesChange(changes: EdgeChange<ArchitectFlowEdge>[]) {
    for (const change of changes) {
      if (change.type === "select") dispatch({ type: "SELECT_EDGE", edgeId: change.selected ? change.id : null });
      if (change.type === "remove") dispatch({ type: "DISCONNECT", edgeId: change.id });
    }
  }

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    dispatch({
      type: "CONNECT",
      connection: {
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle && connection.sourceHandle !== "next" ? { sourceHandle: connection.sourceHandle } : {}),
        ...(connection.targetHandle && connection.targetHandle !== "in" ? { targetHandle: connection.targetHandle } : {}),
      },
    });
  }

  return (
    <div className="architect-canvas" aria-label="Editable workflow canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_, node) => dispatch({ type: "MOVE_NODE", nodeId: node.id, position: node.position })}
        onConnect={onConnect}
        onReconnect={(oldEdge, connection) => {
          if (!connection.target) return;
          dispatch({
            type: "RECONNECT_EDGE",
            edgeId: oldEdge.id,
            target: connection.target,
            ...(connection.targetHandle && connection.targetHandle !== "in" ? { targetHandle: connection.targetHandle } : {}),
          });
        }}
        onNodeClick={(_, node) => dispatch({ type: "SELECT_NODE", nodeId: node.id })}
        onEdgeClick={(_, edge) => dispatch({ type: "SELECT_EDGE", edgeId: edge.id })}
        nodesConnectable
        edgesReconnectable
        nodesDraggable
        elementsSelectable
        deleteKeyCode={null}
        fitView
        minZoom={ARCHITECT_READABLE_MIN_ZOOM}
        maxZoom={1.7}
        fitViewOptions={{ padding: 0.12, minZoom: ARCHITECT_READABLE_MIN_ZOOM, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <p className="sr-only">
        {graph.nodes.length} nodes and {graph.edges.length} edges. Use the labeled editor beside the canvas for keyboard operations.
      </p>
    </div>
  );
}

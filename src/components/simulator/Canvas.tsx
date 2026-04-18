import { useCallback, useMemo, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type Connection,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SimulatorNode } from "@/components/nodes/SimulatorNode";
import { useSimulatorStore } from "@/store/simulatorStore";
import { canConnect } from "@/data/nodeTypes";
import { getDisconnectedNodes } from "@/engine/graphUtils";
import { toast } from "sonner";
import type { SimNode, SimEdge } from "@/types/simulator";

const nodeTypes = {
  simNode: SimulatorNode,
};

function toFlowNodes(simNodes: SimNode[], simEdges: SimEdge[], selectedId: string | null): Node[] {
  const disconnected = getDisconnectedNodes(simNodes, simEdges);
  return simNodes.map((n) => ({
    id: n.id,
    type: "simNode",
    position: n.position,
    selected: n.id === selectedId,
    draggable: !n.locked,
    deletable: !n.locked,
    data: {
      simNodeType: n.type,
      label: n.config.label,
      locked: n.locked,
      model: n.config.model,
      routes: n.config.routes,
      contextGateMode: n.config.contextGateMode,
      isDisconnected: disconnected.includes(n.id),
    },
  }));
}

function toFlowEdges(simEdges: SimEdge[]): Edge[] {
  return simEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    animated: false,
    style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 2 },
  }));
}

export function Canvas() {
  const {
    nodes: simNodes,
    edges: simEdges,
    selectedNodeId,
    isEvaluating,
    addEdge: storeAddEdge,
    removeNode,
    removeEdge,
    updateNodePosition,
    selectNode,
  } = useSimulatorStore();

  const flowNodes = useMemo(() => toFlowNodes(simNodes, simEdges, selectedNodeId), [simNodes, simEdges, selectedNodeId]);
  const flowEdges = useMemo(() => toFlowEdges(simEdges), [simEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Sync from store -> React Flow
  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (isEvaluating) return;

      const sourceNode = simNodes.find((n) => n.id === connection.source);
      const targetNode = simNodes.find((n) => n.id === connection.target);

      if (!sourceNode || !targetNode) return;

      if (!canConnect(sourceNode.type, targetNode.type)) {
        toast.error(`Cannot connect ${sourceNode.type} to ${targetNode.type}`);
        return;
      }

      // Check for duplicate edges
      const exists = simEdges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === connection.sourceHandle
      );
      if (exists) return;

      storeAddEdge({
        id: `e-${Date.now()}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      });
    },
    [simNodes, simEdges, isEvaluating, storeAddEdge]
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      updateNodePosition(node.id, node.position);
    },
    [updateNodePosition]
  );

  const onNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      if (isEvaluating) return;
      deletedNodes.forEach((n) => removeNode(n.id));
    },
    [isEvaluating, removeNode]
  );

  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      if (isEvaluating) return;
      deletedEdges.forEach((e) => removeEdge(e.id));
    },
    [isEvaluating, removeEdge]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useSimulatorStore.getState().undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        useSimulatorStore.getState().redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="w-full h-full relative">
      {isEvaluating && (
        <div className="absolute inset-0 z-10 bg-background/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-auto">
          <div className="text-sm text-muted-foreground animate-pulse">Evaluating...</div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={isEvaluating ? undefined : onNodesChange}
        onEdgesChange={isEvaluating ? undefined : onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        className="bg-background"
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={isEvaluating ? null : "Delete"}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--muted-foreground) / 0.15)" />
        <Controls className="!bg-card !border-border !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted" />
      </ReactFlow>
    </div>
  );
}

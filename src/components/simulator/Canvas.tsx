import { useCallback, useRef, useState, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SimulatorNode } from "@/components/nodes/SimulatorNode";
import { useSimulatorStore } from "@/store/simulatorStore";
import { canConnect, NODE_TYPE_META } from "@/data/nodeTypes";
import { getDisconnectedNodes } from "@/engine/graphUtils";
import { toast } from "sonner";
import type { SimNode, SimEdge, SimNodeType } from "@/types/simulator";

const nodeTypes = {
  simNode: SimulatorNode,
};

function buildFlowNodes(simNodes: SimNode[], simEdges: SimEdge[], selectedNodeId: string | null): Node[] {
  const disconnected = getDisconnectedNodes(simNodes, simEdges);
  return simNodes.map((n) => ({
    id: n.id,
    type: "simNode" as const,
    position: n.position,
    selected: n.id === selectedNodeId,
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

function buildFlowEdges(simEdges: SimEdge[]): Edge[] {
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

function CanvasInner() {
  const isDraggingRef = useRef(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Build initial state from store
  const initialState = useSimulatorStore.getState();
  const [flowNodes, setFlowNodes] = useState<Node[]>(
    () => buildFlowNodes(initialState.nodes, initialState.edges, initialState.selectedNodeId)
  );
  const [flowEdges, setFlowEdges] = useState<Edge[]>(
    () => buildFlowEdges(initialState.edges)
  );
  const isEvaluating = useSimulatorStore((s) => s.isEvaluating);

  // Subscribe to store changes but skip during drag
  useEffect(() => {
    const unsub = useSimulatorStore.subscribe((state) => {
      if (isDraggingRef.current) return;
      setFlowNodes(buildFlowNodes(state.nodes, state.edges, state.selectedNodeId));
      setFlowEdges(buildFlowEdges(state.edges));
    });
    return unsub;
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (useSimulatorStore.getState().isEvaluating) return;
    setFlowNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (useSimulatorStore.getState().isEvaluating) return;
    setFlowEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    isDraggingRef.current = false;
    useSimulatorStore.getState().updateNodePosition(node.id, node.position);
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const store = useSimulatorStore.getState();
    if (store.isEvaluating) return;

    const sourceNode = store.nodes.find((n) => n.id === connection.source);
    const targetNode = store.nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return;

    if (!canConnect(sourceNode.type, targetNode.type)) {
      toast.error(`Cannot connect ${sourceNode.type} to ${targetNode.type}`);
      return;
    }

    const exists = store.edges.some(
      (e) =>
        e.source === connection.source &&
        e.target === connection.target &&
        e.sourceHandle === connection.sourceHandle
    );
    if (exists) return;

    store.addEdge({
      id: `e-${Date.now()}`,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
    });
  }, []);

  const onNodesDelete = useCallback((deletedNodes: Node[]) => {
    const store = useSimulatorStore.getState();
    if (store.isEvaluating) return;
    deletedNodes.forEach((n) => store.removeNode(n.id));
  }, []);

  const onEdgesDelete = useCallback((deletedEdges: Edge[]) => {
    const store = useSimulatorStore.getState();
    if (store.isEvaluating) return;
    deletedEdges.forEach((e) => store.removeEdge(e.id));
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    useSimulatorStore.getState().selectNode(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    useSimulatorStore.getState().selectNode(null);
  }, []);

  // Drop handler for palette drag-and-drop
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/simnode-type") as SimNodeType;
      if (!type) return;

      const store = useSimulatorStore.getState();
      if (store.isEvaluating) return;

      const meta = NODE_TYPE_META[type];
      if (!meta) return;

      // Convert screen position to flow position
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      const id = `${type}-${Date.now()}`;
      const existingCount = store.nodes.filter((n) => n.type === type).length;

      store.addNode({
        id,
        type,
        config: { ...meta.defaultConfig, label: `${meta.label} ${existingCount + 1}` },
        position,
      });
      store.selectNode(id);
    },
    [screenToFlowPosition]
  );

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
    <div className="w-full h-full relative" ref={reactFlowWrapper}>
      {isEvaluating && (
        <div className="absolute inset-0 z-10 bg-background/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-auto">
          <div className="text-sm text-muted-foreground animate-pulse">Evaluating...</div>
        </div>
      )}
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
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

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

import type { NodeConfig, SimEdge, SimNode, SimNodeType } from "@/types/simulator";

export interface BindOperationPatch {
  op: "bind_operation";
  node_id: string;
  expected_node_type: SimNodeType;
  operation_id: string;
  operation_version: string;
  replacement_config: NodeConfig;
}

export interface SetEdgeHandlesPatch {
  op: "set_edge_handles";
  edge_id: string;
  source_handle: string;
  target_handle: string;
}

export interface BindingGraphPatch {
  schema_version: "assurance.graph_patch.v1";
  patch_id: string;
  base_source_graph_hash: string;
  node_operations: BindOperationPatch[];
  edge_operations: SetEdgeHandlesPatch[];
}

export class BindingGraphPatchError extends Error {}

export function assertBindingGraphPatchBase(
  patch: BindingGraphPatch,
  currentSourceGraphHash: string,
) {
  if (patch.base_source_graph_hash !== currentSourceGraphHash) {
    throw new BindingGraphPatchError(
      "The semantic graph changed after this GraphPatch was previewed.",
    );
  }
}

function unique(values: string[], field: string) {
  if (new Set(values).size !== values.length) {
    throw new BindingGraphPatchError(`GraphPatch contains duplicate ${field}.`);
  }
}

export function applyBindingGraphPatch(
  nodes: SimNode[],
  edges: SimEdge[],
  patch: BindingGraphPatch,
): { nodes: SimNode[]; edges: SimEdge[] } {
  if (patch.schema_version !== "assurance.graph_patch.v1") {
    throw new BindingGraphPatchError("GraphPatch schema version is unsupported.");
  }
  if (!/^[0-9a-f]{64}$/.test(patch.base_source_graph_hash)) {
    throw new BindingGraphPatchError("GraphPatch base hash is not canonical SHA-256.");
  }
  unique(patch.node_operations.map((operation) => operation.node_id), "node operations");
  unique(patch.edge_operations.map((operation) => operation.edge_id), "edge operations");

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  for (const operation of patch.node_operations) {
    const node = nodesById.get(operation.node_id);
    if (!node || node.type !== operation.expected_node_type) {
      throw new BindingGraphPatchError(
        `GraphPatch node ${operation.node_id} no longer matches its preview.`,
      );
    }
    if (!operation.operation_id || !operation.operation_version) {
      throw new BindingGraphPatchError("GraphPatch operation identity is incomplete.");
    }
  }
  for (const operation of patch.edge_operations) {
    if (!edgesById.has(operation.edge_id)) {
      throw new BindingGraphPatchError(
        `GraphPatch edge ${operation.edge_id} no longer exists.`,
      );
    }
    if (!operation.source_handle || !operation.target_handle) {
      throw new BindingGraphPatchError("GraphPatch edge handles must be explicit.");
    }
  }

  const nodeOperations = new Map(
    patch.node_operations.map((operation) => [operation.node_id, operation]),
  );
  const edgeOperations = new Map(
    patch.edge_operations.map((operation) => [operation.edge_id, operation]),
  );
  return {
    nodes: nodes.map((node) => {
      const operation = nodeOperations.get(node.id);
      return operation
        ? { ...node, config: structuredClone(operation.replacement_config) }
        : node;
    }),
    edges: edges.map((edge) => {
      const operation = edgeOperations.get(edge.id);
      return operation
        ? {
            ...edge,
            sourceHandle: operation.source_handle,
            targetHandle: operation.target_handle,
          }
        : edge;
    }),
  };
}

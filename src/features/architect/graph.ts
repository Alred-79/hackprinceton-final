import { architectGraphSchema } from "./schema";
import { derivePolicySlots } from "./policySlots";
import type {
  ArchitectEdge,
  ArchitectGraph,
  ArchitectNode,
  ConstraintMapEvidence,
  RouterConfig,
  StructuralEvidence,
  ValidationResult,
} from "./types";

const comparisonOperators = new Set([">", ">=", "<", "<=", "==", "!="]);

function tuple(edge: ArchitectEdge) {
  return [edge.source, edge.sourceHandle ?? "", edge.target, edge.targetHandle ?? ""].join("\u0000");
}

function reachable(start: string, adjacency: Map<string, string[]>): Set<string> {
  const found = new Set<string>();
  const pending = [start];
  while (pending.length) {
    const id = pending.pop()!;
    if (found.has(id)) continue;
    found.add(id);
    pending.push(...(adjacency.get(id) ?? []));
  }
  return found;
}

export function validateArchitectGraph(graph: ArchitectGraph): ValidationResult {
  const parsed = architectGraphSchema.safeParse(graph);
  const errors: string[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`);
  if (!parsed.success) return { valid: false, errors };

  const nodesById = new Map<string, ArchitectNode>();
  for (const node of graph.nodes) {
    if (nodesById.has(node.id)) errors.push(`Duplicate node ID: ${node.id}.`);
    nodesById.set(node.id, node);
  }
  const edgeIds = new Set<string>();
  const edgeTuples = new Set<string>();
  const incoming = new Map<string, ArchitectEdge[]>();
  const outgoing = new Map<string, ArchitectEdge[]>();
  for (const node of graph.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge ID: ${edge.id}.`);
    edgeIds.add(edge.id);
    const identity = tuple(edge);
    if (edgeTuples.has(identity)) errors.push(`Duplicate edge connection: ${edge.id}.`);
    edgeTuples.add(identity);
    if (edge.source === edge.target) errors.push(`Self edge is not allowed: ${edge.id}.`);
    if (!nodesById.has(edge.source)) errors.push(`Edge ${edge.id} has missing source ${edge.source}.`);
    if (!nodesById.has(edge.target)) errors.push(`Edge ${edge.id} has missing target ${edge.target}.`);
    if (edge.targetHandle !== undefined && edge.targetHandle !== "in") {
      errors.push(`Edge ${edge.id} has invalid target handle ${edge.targetHandle}; only “in” or omission is allowed.`);
    }
    if (nodesById.get(edge.target)?.kind === "input") {
      errors.push(`Edge ${edge.id} cannot target the input node or an input handle.`);
    }
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }

  const inputs = graph.nodes.filter((node) => node.kind === "input");
  const outputs = graph.nodes.filter((node) => node.kind === "output");
  if (inputs.length !== 1) errors.push("Graph must contain exactly one input node.");
  if (outputs.length !== 1) errors.push("Graph must contain exactly one output node.");
  if (inputs[0] && (incoming.get(inputs[0].id)?.length ?? 0) !== 0) errors.push("Input cannot have a predecessor.");
  if (outputs[0] && (outgoing.get(outputs[0].id)?.length ?? 0) !== 0) errors.push("Output cannot have a successor.");

  for (const node of graph.nodes) {
    const ins = incoming.get(node.id)?.length ?? 0;
    const outs = outgoing.get(node.id)?.length ?? 0;
    if (node.kind !== "input" && ins === 0) errors.push(`Orphan node ${node.id} has no predecessor.`);
    if (node.kind !== "output" && outs === 0) errors.push(`Orphan node ${node.id} has no successor.`);
    if (node.kind === "router") {
      const config = node.config as RouterConfig;
      const routeIds = config.routes.map((route) => route.id);
      if (new Set(routeIds).size !== 2) errors.push(`Router ${node.id} has duplicate route IDs.`);
      if (config.routes.filter((route) => route.role === "condition").length !== 1) {
        errors.push(`Router ${node.id} must have exactly one condition route.`);
      }
      if (config.routes.filter((route) => route.role === "default").length !== 1) {
        errors.push(`Router ${node.id} must have exactly one named default route.`);
      }
      const condition = config.routes.find((route) => route.role === "condition");
      const fallback = config.routes.find((route) => route.role === "default");
      if (condition?.id !== config.conditionRouteId) errors.push(`Router ${node.id} condition route pointer is invalid.`);
      if (fallback?.id !== config.defaultRouteId) errors.push(`Router ${node.id} default route pointer is invalid.`);
      if (config.operand === "unsupported" && config.operator !== "default") {
        errors.push(`Router ${node.id} unsupported operands must use the default operator.`);
      }
      if (config.operand !== "unsupported" && config.operator === "default") {
        errors.push(`Router ${node.id} supported operands cannot use the default operator.`);
      }
      if (comparisonOperators.has(config.operator) && config.comparisonValue === undefined) {
        errors.push(`Router ${node.id} comparison operator requires a comparison value.`);
      }
      if (!comparisonOperators.has(config.operator) && config.comparisonValue !== undefined) {
        errors.push(`Router ${node.id} operator does not accept a comparison value.`);
      }
      if (config.operand === "fixture.numericValue") {
        if (["truthy", "falsy"].includes(config.operator)) {
          errors.push(`Router ${node.id} numeric operands require a comparison operator.`);
        }
        if (comparisonOperators.has(config.operator) && typeof config.comparisonValue !== "number") {
          errors.push(`Router ${node.id} numeric comparisons require a numeric value.`);
        }
      }
      if (config.operand === "fixture.booleanFlag") {
        if ([">", ">=", "<", "<="].includes(config.operator)) {
          errors.push(`Router ${node.id} boolean operands do not allow numeric comparison operators.`);
        }
        if (["==", "!="].includes(config.operator) && typeof config.comparisonValue !== "boolean") {
          errors.push(`Router ${node.id} boolean equality requires a boolean value.`);
        }
      }
      const routeEdges = outgoing.get(node.id) ?? [];
      for (const edge of routeEdges) {
        if (!edge.sourceHandle || !routeIds.includes(edge.sourceHandle)) {
          errors.push(`Router edge ${edge.id} must use a valid route handle.`);
        }
      }
      for (const routeId of routeIds) {
        if (routeEdges.filter((edge) => edge.sourceHandle === routeId).length !== 1) {
          errors.push(`Router ${node.id} requires exactly one outgoing edge for route ${routeId}.`);
        }
      }
    } else if ((outgoing.get(node.id) ?? []).some((edge) => edge.sourceHandle !== undefined)) {
      errors.push(`Non-router node ${node.id} cannot use a source route handle.`);
    }
  }

  if (inputs.length === 1 && outputs.length === 1) {
    const forward = new Map<string, string[]>();
    const reverse = new Map<string, string[]>();
    for (const node of graph.nodes) {
      forward.set(node.id, []);
      reverse.set(node.id, []);
    }
    for (const edge of graph.edges) {
      forward.get(edge.source)?.push(edge.target);
      reverse.get(edge.target)?.push(edge.source);
    }
    const fromInput = reachable(inputs[0].id, forward);
    const toOutput = reachable(outputs[0].id, reverse);
    for (const node of graph.nodes) {
      if (!fromInput.has(node.id)) errors.push(`Node ${node.id} is unreachable from input.`);
      if (!toOutput.has(node.id)) errors.push(`Node ${node.id} cannot reach output.`);
    }

    const indegree = new Map(graph.nodes.map((node) => [node.id, incoming.get(node.id)?.length ?? 0]));
    const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift()!;
      visited += 1;
      for (const target of forward.get(id) ?? []) {
        const next = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, next);
        if (next === 0) queue.push(target);
      }
    }
    if (visited !== graph.nodes.length) errors.push("Graph contains a cycle.");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function canonicalConfig(node: ArchitectNode): Record<string, unknown> {
  switch (node.config.type) {
    case "action":
      return {
        actionKind: node.config.actionKind,
        operationVerb: node.config.operationVerb,
        simulated: node.config.simulated,
      };
    case "router":
      return {
        displayCondition: node.config.displayCondition,
        operand: node.config.operand,
        operator: node.config.operator,
        ...(node.config.comparisonValue === undefined ? {} : { comparisonValue: node.config.comparisonValue }),
        routes: [...node.config.routes]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((route) => ({ id: route.id, role: route.role })),
        conditionRouteId: node.config.conditionRouteId,
        defaultRouteId: node.config.defaultRouteId,
      };
    case "evaluator":
      return { criterion: node.config.criterion };
    case "human_review":
      return { instruction: node.config.instruction };
    case "schema_gate":
      return {
        contractName: node.config.contractName,
        mode: node.config.mode,
        requiredFields: [...node.config.requiredFields].sort((a, b) => a.localeCompare(b)),
        violationBehavior: node.config.violationBehavior,
      };
    case "context_gate":
      return {
        tokenCap: node.config.tokenCap,
        strategy: node.config.strategy,
        allowedSources: [...node.config.allowedSources].sort((a, b) => a.localeCompare(b)),
        blockedFields: [...node.config.blockedFields].sort((a, b) => a.localeCompare(b)),
      };
    default:
      return {};
  }
}

export function canonicalArchitectJson(graph: ArchitectGraph): string {
  const canonical = {
    schemaVersion: graph.schemaVersion,
    lexiconVersion: graph.lexiconVersion,
    nodes: [...graph.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => ({ id: node.id, kind: node.kind, config: canonicalConfig(node) })),
    edges: [...graph.edges]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
        target: edge.target,
        ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      })),
  };
  return JSON.stringify(canonical);
}

export function structuralEvidence(graph: ArchitectGraph): StructuralEvidence {
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    incoming.get(edge.target)?.push(edge.source);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const indegree = new Map([...incoming].map(([id, sources]) => [id, sources.length]));
  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id).sort();
  const distance = new Map(graph.nodes.map((node) => [node.id, 1]));
  while (queue.length) {
    const id = queue.shift()!;
    for (const target of outgoing.get(id) ?? []) {
      distance.set(target, Math.max(distance.get(target) ?? 1, (distance.get(id) ?? 1) + 1));
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  const parallelWidths = graph.nodes
    .filter((node) => node.kind !== "router")
    .map((node) => outgoing.get(node.id)?.length ?? 0);
  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    criticalPathLength: Math.max(...distance.values()),
    maximumExplicitParallelWidth: Math.max(1, ...parallelWidths),
    guardedBranchCount: graph.nodes.filter((node) => node.kind === "router").length,
  };
}

export function constraintMapEvidence(graph: ArchitectGraph): ConstraintMapEvidence {
  return {
    schemaGateCount: graph.nodes.filter((node) => node.kind === "schema_gate").length,
    contextBoundaryCount: graph.nodes.filter((node) => node.kind === "context_gate").length,
    humanReviewCount: graph.nodes.filter((node) => node.kind === "human_review").length,
    routerCount: graph.nodes.filter((node) => node.kind === "router").length,
    unresolvedDecisionSlotCount: derivePolicySlots(graph).length,
  };
}

export function cloneGraph(graph: ArchitectGraph): ArchitectGraph {
  return structuredClone(graph);
}

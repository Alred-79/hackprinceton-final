import type { SimNode, SimEdge } from "@/types/simulator";

export function getAdjacencyList(nodes: SimNode[], edges: SimEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => {
    const list = adj.get(e.source);
    if (list) list.push(e.target);
  });
  return adj;
}

export function getIncomingMap(nodes: SimNode[], edges: SimEdge[]): Map<string, string[]> {
  const inc = new Map<string, string[]>();
  nodes.forEach((n) => inc.set(n.id, []));
  edges.forEach((e) => {
    const list = inc.get(e.target);
    if (list) list.push(e.source);
  });
  return inc;
}

export function detectCycles(nodes: SimNode[], edges: SimEdge[]): string[][] {
  const adj = getAdjacencyList(nodes, edges);
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(nodeId: string, path: string[]): void {
    visited.add(nodeId);
    recStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adj.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, path);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
      }
    }

    path.pop();
    recStack.delete(nodeId);
  }

  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      dfs(n.id, []);
    }
  });

  return cycles;
}

export function findParallelBranches(nodes: SimNode[], edges: SimEdge[]): number {
  const adj = getAdjacencyList(nodes, edges);
  let maxParallel = 1;

  nodes.forEach((n) => {
    const outputs = adj.get(n.id) || [];
    if (outputs.length > 1) {
      maxParallel = Math.max(maxParallel, outputs.length);
    }
  });

  return maxParallel;
}

export function topologicalSort(nodes: SimNode[], edges: SimEdge[]): string[] {
  const adj = getAdjacencyList(nodes, edges);
  const inDegree = new Map<string, number>();
  nodes.forEach((n) => inDegree.set(n.id, 0));
  edges.forEach((e) => {
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  });

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    const neighbors = adj.get(current) || [];
    for (const neighbor of neighbors) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

export function getDisconnectedNodes(nodes: SimNode[], edges: SimEdge[]): string[] {
  const connected = new Set<string>();
  edges.forEach((e) => {
    connected.add(e.source);
    connected.add(e.target);
  });
  return nodes.filter((n) => !connected.has(n.id)).map((n) => n.id);
}

export function countChainedExecutorsWithoutGate(nodes: SimNode[], edges: SimEdge[]): number {
  const adj = getAdjacencyList(nodes, edges);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let maxChain = 0;

  function countChain(nodeId: string, currentChain: number): void {
    const neighbors = adj.get(nodeId) || [];
    for (const neighbor of neighbors) {
      const neighborNode = nodeMap.get(neighbor);
      if (!neighborNode) continue;
      if (neighborNode.type === "executor") {
        const newChain = currentChain + 1;
        maxChain = Math.max(maxChain, newChain);
        countChain(neighbor, newChain);
      } else if (neighborNode.type === "context_gate") {
        countChain(neighbor, 0);
      } else {
        countChain(neighbor, currentChain);
      }
    }
  }

  nodes.forEach((n) => {
    if (n.type === "executor") {
      countChain(n.id, 1);
    }
  });

  return maxChain;
}

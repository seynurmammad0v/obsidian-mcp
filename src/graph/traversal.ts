import type { VaultGraphStore } from './index.js';

type Direction = 'in' | 'out' | 'both';

interface TraversalNode {
  path: string;
  title: string;
  depth: number;
  tags: string[];
}

interface TraversalEdge {
  from: string;
  to: string;
}

export interface TraversalResult {
  root: string;
  nodes: TraversalNode[];
  edges: TraversalEdge[];
}

export interface PathNode {
  path: string;
  title: string;
}

function getNeighbors(
  graph: VaultGraphStore,
  path: string,
  direction: Direction
): string[] {
  const node = graph.getNode(path);
  if (!node) return [];

  const neighbors: string[] = [];

  if (direction === 'out' || direction === 'both') {
    for (const link of node.outLinks) {
      const resolved = graph.resolveLink(link);
      if (resolved) neighbors.push(resolved);
    }
  }

  if (direction === 'in' || direction === 'both') {
    neighbors.push(...node.inLinks);
  }

  return [...new Set(neighbors)];
}

export function bfs(
  graph: VaultGraphStore,
  startPath: string,
  maxDepth: number,
  direction: Direction,
  filterTags?: string[]
): TraversalResult {
  const visited = new Set<string>();
  const nodes: TraversalNode[] = [];
  const edges: TraversalEdge[] = [];
  const queue: Array<{ path: string; depth: number }> = [];

  const startNode = graph.getNode(startPath);
  if (!startNode) return { root: startPath, nodes: [], edges: [] };

  visited.add(startPath);
  queue.push({ path: startPath, depth: 0 });
  nodes.push({ path: startPath, title: startNode.title, depth: 0, tags: startNode.tags });

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = getNeighbors(graph, path, direction);
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      const neighborNode = graph.getNode(neighbor);
      if (!neighborNode) continue;

      if (filterTags && filterTags.length > 0) {
        const hasAllTags = filterTags.every(t => neighborNode.tags.includes(t));
        if (!hasAllTags) continue;
      }

      visited.add(neighbor);
      nodes.push({ path: neighbor, title: neighborNode.title, depth: depth + 1, tags: neighborNode.tags });
      edges.push({ from: path, to: neighbor });
      queue.push({ path: neighbor, depth: depth + 1 });
    }
  }

  return { root: startPath, nodes, edges };
}

export function dfs(
  graph: VaultGraphStore,
  startPath: string,
  maxDepth: number,
  direction: Direction,
  filterTags?: string[]
): TraversalResult {
  const visited = new Set<string>();
  const nodes: TraversalNode[] = [];
  const edges: TraversalEdge[] = [];

  function visit(path: string, depth: number): void {
    if (visited.has(path) || depth > maxDepth) return;

    const node = graph.getNode(path);
    if (!node) return;

    visited.add(path);
    nodes.push({ path, title: node.title, depth, tags: node.tags });

    const neighbors = getNeighbors(graph, path, direction);
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      const neighborNode = graph.getNode(neighbor);
      if (!neighborNode) continue;

      if (filterTags && filterTags.length > 0) {
        const hasAllTags = filterTags.every(t => neighborNode.tags.includes(t));
        if (!hasAllTags) continue;
      }

      edges.push({ from: path, to: neighbor });
      visit(neighbor, depth + 1);
    }
  }

  visit(startPath, 0);
  return { root: startPath, nodes, edges };
}

export function shortestPath(
  graph: VaultGraphStore,
  fromPath: string,
  toPath: string,
  direction: Direction
): PathNode[] | null {
  if (fromPath === toPath) {
    const node = graph.getNode(fromPath);
    return node ? [{ path: node.path, title: node.title }] : null;
  }

  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [fromPath];
  visited.add(fromPath);

  while (queue.length > 0) {
    const current = queue.shift()!;

    const neighbors = getNeighbors(graph, current, direction);
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, current);

      if (neighbor === toPath) {
        const result: PathNode[] = [];
        let step: string | undefined = toPath;
        while (step !== undefined) {
          const node = graph.getNode(step);
          if (node) result.unshift({ path: node.path, title: node.title });
          step = parent.get(step);
        }
        return result;
      }

      queue.push(neighbor);
    }
  }

  return null;
}

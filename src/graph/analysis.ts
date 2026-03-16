import type { VaultGraphStore } from './index.js';

export interface OrphanResult {
  path: string;
  title: string;
}

export interface HubResult {
  path: string;
  title: string;
  inLinks: number;
  outLinks: number;
  total: number;
}

export interface ComponentResult {
  id: number;
  noteCount: number;
  notes: string[];
}

export interface BridgeResult {
  path: string;
  title: string;
  componentsSplit: number;
}

export interface DeadLinkResult {
  target: string;
  referencedBy: Array<{ path: string; linkText: string }>;
}

export function findOrphans(graph: VaultGraphStore): OrphanResult[] {
  return graph
    .allNodes()
    .filter(n => n.outLinks.length === 0 && n.inLinks.length === 0)
    .map(n => ({ path: n.path, title: n.title }));
}

export function findHubs(graph: VaultGraphStore, limit: number): HubResult[] {
  return graph
    .allNodes()
    .map(n => ({
      path: n.path,
      title: n.title,
      inLinks: n.inLinks.length,
      outLinks: n.outLinks.length,
      total: n.inLinks.length + n.outLinks.length,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function findComponents(graph: VaultGraphStore): ComponentResult[] {
  const nodes = graph.allNodes();
  const visited = new Set<string>();
  const components: ComponentResult[] = [];
  let componentId = 0;

  for (const node of nodes) {
    if (visited.has(node.path)) continue;

    const component: string[] = [];
    const queue = [node.path];
    visited.add(node.path);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      const currentNode = graph.getNode(current);
      if (!currentNode) continue;

      const neighbors = new Set<string>();
      for (const link of currentNode.outLinks) {
        const resolved = graph.resolveLink(link);
        if (resolved) neighbors.add(resolved);
      }
      for (const inLink of currentNode.inLinks) {
        neighbors.add(inLink);
      }

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push({
      id: componentId++,
      noteCount: component.length,
      notes: component,
    });
  }

  return components;
}

export function findBridges(graph: VaultGraphStore): BridgeResult[] {
  const baseComponents = findComponents(graph).length;
  const bridges: BridgeResult[] = [];
  const allNodes = graph.allNodes();

  for (const node of allNodes) {
    const remaining = allNodes.filter(n => n.path !== node.path);
    const visited = new Set<string>();
    let tempComponents = 0;

    for (const n of remaining) {
      if (visited.has(n.path)) continue;

      tempComponents++;
      const queue = [n.path];
      visited.add(n.path);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentNode = graph.getNode(current);
        if (!currentNode) continue;

        const neighbors = new Set<string>();
        for (const link of currentNode.outLinks) {
          const resolved = graph.resolveLink(link);
          if (resolved && resolved !== node.path) neighbors.add(resolved);
        }
        for (const inLink of currentNode.inLinks) {
          if (inLink !== node.path) neighbors.add(inLink);
        }

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    if (tempComponents > baseComponents) {
      bridges.push({
        path: node.path,
        title: node.title,
        componentsSplit: tempComponents - baseComponents + 1,
      });
    }
  }

  return bridges;
}

export function findDeadLinks(graph: VaultGraphStore): DeadLinkResult[] {
  return graph.getDeadLinks();
}

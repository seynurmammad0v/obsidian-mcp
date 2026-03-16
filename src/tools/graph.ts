import { z } from 'zod';
import type { VaultGraphStore } from '../graph/index.js';
import { bfs, dfs, shortestPath } from '../graph/traversal.js';
import { findOrphans, findHubs, findComponents, findBridges, findDeadLinks } from '../graph/analysis.js';

export function graphToolDefs() {
  return {
    graph_neighbors: {
      name: 'graph_neighbors',
      description: 'Get direct [[links]] and backlinks for a note.',
      inputSchema: {
        path: z.string().describe('Relative path to the note'),
        direction: z.enum(['in', 'out', 'both']).optional().default('both'),
      },
    },
    graph_traverse: {
      name: 'graph_traverse',
      description: 'BFS or DFS traversal from a starting note, up to N hops deep. Returns flat node list with depth and edge list.',
      inputSchema: {
        path: z.string().describe('Starting note path'),
        depth: z.number().min(1).max(10).optional().default(3),
        algorithm: z.enum(['bfs', 'dfs']).optional().default('bfs'),
        direction: z.enum(['in', 'out', 'both']).optional().default('out'),
        filter_tags: z.array(z.string()).optional(),
      },
    },
    graph_shortest_path: {
      name: 'graph_shortest_path',
      description: 'Find the shortest link chain between two notes.',
      inputSchema: {
        from: z.string().describe('Starting note path'),
        to: z.string().describe('Target note path'),
        direction: z.enum(['out', 'both']).optional().default('both'),
      },
    },
    graph_analyze: {
      name: 'graph_analyze',
      description: 'Structural analysis: connected components, orphan notes, bridge notes, hub notes, or dead links.',
      inputSchema: {
        analysis: z.enum(['components', 'orphans', 'bridges', 'hubs', 'dead_links']),
        limit: z.number().optional().default(20),
      },
    },
  };
}

export function createGraphHandlers(graph: VaultGraphStore) {
  return {
    async graph_neighbors({ path, direction = 'both' }: { path: string; direction?: 'in' | 'out' | 'both' }) {
      const node = graph.getNode(path);
      if (!node) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${path}` }], isError: true };
      }

      const neighbors: Array<{ path: string; title: string; direction: string; tags: string[] }> = [];

      if (direction === 'out' || direction === 'both') {
        for (const link of node.outLinks) {
          const resolved = graph.resolveLink(link);
          if (resolved) {
            const target = graph.getNode(resolved);
            if (target) neighbors.push({ path: target.path, title: target.title, direction: 'out', tags: target.tags });
          }
        }
      }

      if (direction === 'in' || direction === 'both') {
        for (const inLink of node.inLinks) {
          const source = graph.getNode(inLink);
          if (source) neighbors.push({ path: source.path, title: source.title, direction: 'in', tags: source.tags });
        }
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(neighbors, null, 2) }] };
    },

    async graph_traverse({
      path, depth = 3, algorithm = 'bfs', direction = 'out', filter_tags,
    }: {
      path: string; depth?: number; algorithm?: 'bfs' | 'dfs'; direction?: 'in' | 'out' | 'both'; filter_tags?: string[];
    }) {
      if (!graph.getNode(path)) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${path}` }], isError: true };
      }

      const result = algorithm === 'bfs'
        ? bfs(graph, path, depth, direction, filter_tags)
        : dfs(graph, path, depth, direction, filter_tags);

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },

    async graph_shortest_path({ from, to, direction = 'both' }: { from: string; to: string; direction?: 'out' | 'both' }) {
      if (!graph.getNode(from)) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${from}` }], isError: true };
      }
      if (!graph.getNode(to)) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${to}` }], isError: true };
      }

      const result = shortestPath(graph, from, to, direction);

      return {
        content: [{
          type: 'text' as const,
          text: result ? JSON.stringify(result, null, 2) : JSON.stringify({ path: null, message: 'No path exists between these notes' }),
        }],
      };
    },

    async graph_analyze({ analysis, limit = 20 }: { analysis: 'components' | 'orphans' | 'bridges' | 'hubs' | 'dead_links'; limit?: number }) {
      let result: unknown;

      switch (analysis) {
        case 'components': result = findComponents(graph); break;
        case 'orphans': result = findOrphans(graph); break;
        case 'bridges': result = findBridges(graph); break;
        case 'hubs': result = findHubs(graph, limit); break;
        case 'dead_links': result = findDeadLinks(graph); break;
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  };
}

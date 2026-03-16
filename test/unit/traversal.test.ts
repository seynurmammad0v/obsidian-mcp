import { describe, it, expect } from 'vitest';
import { bfs, dfs, shortestPath } from '../../src/graph/traversal.js';
import { VaultGraphStore } from '../../src/graph/index.js';
import type { VaultNode } from '../../src/types.js';

function makeNode(path: string, outLinks: string[] = [], tags: string[] = []): VaultNode {
  return { path, title: path.replace('.md', ''), frontmatter: {}, tags, outLinks, inLinks: [], sections: [] };
}

function buildGraph(nodes: VaultNode[]): VaultGraphStore {
  const g = new VaultGraphStore();
  for (const n of nodes) g.addNode(n);
  g.recomputeInLinks();
  return g;
}

const chain = () => buildGraph([
  makeNode('a.md', ['b.md']),
  makeNode('b.md', ['c.md']),
  makeNode('c.md', []),
]);

const diamond = () => buildGraph([
  makeNode('a.md', ['b.md']),
  makeNode('b.md', ['a.md', 'c.md']),
  makeNode('c.md', ['d.md']),
  makeNode('d.md', []),
]);

describe('bfs', () => {
  it('traverses chain with depth=1', () => {
    const result = bfs(chain(), 'a.md', 1, 'out');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].depth).toBe(0);
    expect(result.nodes[1].depth).toBe(1);
  });

  it('traverses chain with depth=3', () => {
    const result = bfs(chain(), 'a.md', 3, 'out');
    expect(result.nodes).toHaveLength(3);
  });

  it('follows backlinks with direction=in', () => {
    const result = bfs(chain(), 'c.md', 2, 'in');
    expect(result.nodes.map(n => n.path)).toContain('b.md');
  });

  it('follows both directions', () => {
    const result = bfs(chain(), 'b.md', 1, 'both');
    expect(result.nodes.map(n => n.path)).toContain('a.md');
    expect(result.nodes.map(n => n.path)).toContain('c.md');
  });

  it('handles circular links without looping', () => {
    const result = bfs(diamond(), 'a.md', 10, 'both');
    expect(result.nodes.length).toBeLessThanOrEqual(4);
  });

  it('includes edges', () => {
    const result = bfs(chain(), 'a.md', 2, 'out');
    expect(result.edges).toContainEqual({ from: 'a.md', to: 'b.md' });
    expect(result.edges).toContainEqual({ from: 'b.md', to: 'c.md' });
  });

  it('filters by tags', () => {
    const g = buildGraph([
      makeNode('a.md', ['b.md', 'c.md']),
      makeNode('b.md', ['d.md'], ['go']),
      makeNode('c.md', ['d.md'], ['react']),
      makeNode('d.md', [], ['go']),
    ]);
    const result = bfs(g, 'a.md', 3, 'out', ['go']);
    const paths = result.nodes.map(n => n.path);
    expect(paths).toContain('b.md');
    expect(paths).not.toContain('c.md');
  });
});

describe('dfs', () => {
  it('traverses chain', () => {
    const result = dfs(chain(), 'a.md', 3, 'out');
    expect(result.nodes).toHaveLength(3);
  });
});

describe('shortestPath', () => {
  it('finds path in chain', () => {
    const result = shortestPath(chain(), 'a.md', 'c.md', 'both');
    expect(result).not.toBeNull();
    expect(result!.map(n => n.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('returns null when no path exists', () => {
    const g = buildGraph([makeNode('a.md', []), makeNode('b.md', [])]);
    const result = shortestPath(g, 'a.md', 'b.md', 'out');
    expect(result).toBeNull();
  });

  it('finds bidirectional path', () => {
    const result = shortestPath(chain(), 'c.md', 'a.md', 'both');
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(3);
  });

  it('returns null for forward-only when path is reversed', () => {
    const result = shortestPath(chain(), 'c.md', 'a.md', 'out');
    expect(result).toBeNull();
  });
});

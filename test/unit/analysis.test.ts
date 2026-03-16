import { describe, it, expect } from 'vitest';
import { findOrphans, findHubs, findComponents, findBridges, findDeadLinks } from '../../src/graph/analysis.js';
import { VaultGraphStore } from '../../src/graph/index.js';
import type { VaultNode } from '../../src/types.js';

function makeNode(path: string, outLinks: string[] = []): VaultNode {
  return { path, title: path.replace('.md', ''), frontmatter: {}, tags: [], outLinks, inLinks: [], sections: [] };
}

function buildGraph(nodes: VaultNode[]): VaultGraphStore {
  const g = new VaultGraphStore();
  for (const n of nodes) g.addNode(n);
  g.recomputeInLinks();
  return g;
}

describe('findOrphans', () => {
  it('finds notes with no links', () => {
    const g = buildGraph([
      makeNode('connected.md', ['other.md']),
      makeNode('other.md', []),
      makeNode('orphan.md', []),
    ]);
    const orphans = findOrphans(g);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].path).toBe('orphan.md');
  });
});

describe('findHubs', () => {
  it('returns notes sorted by total connections', () => {
    const g = buildGraph([
      makeNode('hub.md', ['a.md', 'b.md', 'c.md']),
      makeNode('a.md', ['hub.md']),
      makeNode('b.md', []),
      makeNode('c.md', []),
    ]);
    const hubs = findHubs(g, 10);
    expect(hubs[0].path).toBe('hub.md');
    expect(hubs[0].total).toBeGreaterThan(hubs[1].total);
  });

  it('respects limit', () => {
    const g = buildGraph([
      makeNode('a.md', ['b.md']),
      makeNode('b.md', ['c.md']),
      makeNode('c.md', []),
    ]);
    const hubs = findHubs(g, 1);
    expect(hubs).toHaveLength(1);
  });
});

describe('findComponents', () => {
  it('finds separate components', () => {
    const g = buildGraph([
      makeNode('a.md', ['b.md']),
      makeNode('b.md', []),
      makeNode('c.md', ['d.md']),
      makeNode('d.md', []),
    ]);
    const components = findComponents(g);
    expect(components).toHaveLength(2);
  });

  it('finds single component for connected graph', () => {
    const g = buildGraph([
      makeNode('a.md', ['b.md']),
      makeNode('b.md', ['c.md']),
      makeNode('c.md', ['a.md']),
    ]);
    const components = findComponents(g);
    expect(components).toHaveLength(1);
  });
});

describe('findBridges', () => {
  it('identifies bridge nodes', () => {
    const g = buildGraph([
      makeNode('a.md', ['b.md']),
      makeNode('b.md', ['c.md']),
      makeNode('c.md', []),
    ]);
    const bridges = findBridges(g);
    expect(bridges.some(b => b.path === 'b.md')).toBe(true);
  });
});

describe('findDeadLinks', () => {
  it('finds links to nonexistent notes', () => {
    const g = buildGraph([
      makeNode('a.md', ['nonexistent']),
      makeNode('b.md', ['also-missing']),
    ]);
    const dead = findDeadLinks(g);
    expect(dead).toHaveLength(2);
  });
});

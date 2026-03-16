import { describe, it, expect } from 'vitest';
import { VaultGraphStore } from '../../src/graph/index.js';
import type { VaultNode } from '../../src/types.js';

function makeNode(path: string, outLinks: string[] = []): VaultNode {
  return { path, title: path.replace('.md', ''), frontmatter: {}, tags: [], outLinks, inLinks: [], sections: [] };
}

describe('VaultGraphStore', () => {
  it('adds a node', () => {
    const g = new VaultGraphStore();
    g.addNode(makeNode('a.md', ['b']));
    expect(g.getNode('a.md')).toBeDefined();
    expect(g.getNode('a.md')!.outLinks).toEqual(['b']);
  });

  it('computes inLinks when nodes reference each other', () => {
    const g = new VaultGraphStore();
    g.addNode(makeNode('a.md', ['b']));
    g.addNode(makeNode('b.md', []));
    g.recomputeInLinks();
    expect(g.getNode('b.md')!.inLinks).toContain('a.md');
  });

  it('updates a node and recomputes inLinks', () => {
    const g = new VaultGraphStore();
    g.addNode(makeNode('a.md', ['b']));
    g.addNode(makeNode('b.md', []));
    g.addNode(makeNode('c.md', []));
    g.recomputeInLinks();

    g.updateNode(makeNode('a.md', ['c']));
    g.recomputeInLinks();
    expect(g.getNode('b.md')!.inLinks).not.toContain('a.md');
    expect(g.getNode('c.md')!.inLinks).toContain('a.md');
  });

  it('removes a node', () => {
    const g = new VaultGraphStore();
    g.addNode(makeNode('a.md', ['b']));
    g.addNode(makeNode('b.md', []));
    g.removeNode('a.md');
    expect(g.getNode('a.md')).toBeUndefined();
    expect(g.size).toBe(1);
  });

  it('resolves link targets using basename matching', () => {
    const g = new VaultGraphStore();
    g.addNode(makeNode('folder/deep/note.md', []));
    g.addNode(makeNode('other.md', ['note']));
    g.recomputeInLinks();
    expect(g.getNode('folder/deep/note.md')!.inLinks).toContain('other.md');
  });

  it('reports all nodes', () => {
    const g = new VaultGraphStore();
    g.addNode(makeNode('a.md'));
    g.addNode(makeNode('b.md'));
    expect(g.allNodes()).toHaveLength(2);
  });

  it('tracks phantom nodes (dead links)', () => {
    const g = new VaultGraphStore();
    g.addNode(makeNode('a.md', ['nonexistent']));
    g.recomputeInLinks();
    expect(g.getDeadLinks()).toHaveLength(1);
    expect(g.getDeadLinks()[0].target).toBe('nonexistent');
  });
});

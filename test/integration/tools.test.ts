import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { scanVault } from '../../src/vault/scanner.js';
import { createReadingHandlers } from '../../src/tools/reading.js';
import { createGraphHandlers } from '../../src/tools/graph.js';
import { DEFAULT_CONFIG } from '../../src/types.js';
import type { VaultGraphStore } from '../../src/graph/index.js';

const VAULT_PATH = resolve(import.meta.dirname, '../fixtures/vault');

let graph: VaultGraphStore;

beforeAll(async () => {
  graph = await scanVault(VAULT_PATH, DEFAULT_CONFIG);
});

describe('vault_stats', () => {
  it('returns correct note count', async () => {
    const handlers = createReadingHandlers(graph, VAULT_PATH, DEFAULT_CONFIG);
    const result = await handlers.vault_stats();
    const data = JSON.parse(result.content[0].text);
    expect(data.totalNotes).toBe(12);
  });

  it('detects orphan notes', async () => {
    const handlers = createReadingHandlers(graph, VAULT_PATH, DEFAULT_CONFIG);
    const result = await handlers.vault_stats();
    const data = JSON.parse(result.content[0].text);
    expect(data.orphanNotes).toBeGreaterThanOrEqual(1);
  });
});

describe('read_note', () => {
  it('reads a note with frontmatter', async () => {
    const handlers = createReadingHandlers(graph, VAULT_PATH, DEFAULT_CONFIG);
    const result = await handlers.read_note({ path: 'tagged-go.md' });
    const data = JSON.parse(result.content[0].text);
    expect(data.title).toBe('Go Best Practices');
    expect(data.frontmatter.tags).toContain('go');
    expect(data.tags).toContain('error-handling');
  });

  it('returns error for nonexistent note', async () => {
    const handlers = createReadingHandlers(graph, VAULT_PATH, DEFAULT_CONFIG);
    const result = await handlers.read_note({ path: 'nope.md' });
    expect(result.isError).toBe(true);
  });
});

describe('search_notes', () => {
  it('searches by tag', async () => {
    const handlers = createReadingHandlers(graph, VAULT_PATH, DEFAULT_CONFIG);
    const result = await handlers.search_notes({ tags: ['go'] });
    const data = JSON.parse(result.content[0].text);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((n: { tags: string[] }) => n.tags.includes('go'))).toBe(true);
  });

  it('searches by keyword', async () => {
    const handlers = createReadingHandlers(graph, VAULT_PATH, DEFAULT_CONFIG);
    const result = await handlers.search_notes({ query: 'error handling' });
    const data = JSON.parse(result.content[0].text);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('graph_neighbors', () => {
  it('finds outgoing links from hub note', async () => {
    const handlers = createGraphHandlers(graph);
    const result = await handlers.graph_neighbors({ path: 'hub-note.md', direction: 'out' });
    const data = JSON.parse(result.content[0].text);
    expect(data.length).toBeGreaterThanOrEqual(5);
  });

  it('finds incoming links to chain-b', async () => {
    const handlers = createGraphHandlers(graph);
    const result = await handlers.graph_neighbors({ path: 'chain-b.md', direction: 'in' });
    const data = JSON.parse(result.content[0].text);
    expect(data.some((n: { path: string }) => n.path === 'chain-a.md')).toBe(true);
  });
});

describe('graph_traverse', () => {
  it('traverses from chain-a to chain-c via BFS', async () => {
    const handlers = createGraphHandlers(graph);
    const result = await handlers.graph_traverse({ path: 'chain-a.md', depth: 3, algorithm: 'bfs', direction: 'out' });
    const data = JSON.parse(result.content[0].text);
    const paths = data.nodes.map((n: { path: string }) => n.path);
    expect(paths).toContain('chain-b.md');
    expect(paths).toContain('chain-c.md');
  });
});

describe('graph_shortest_path', () => {
  it('finds path from chain-a to chain-c', async () => {
    const handlers = createGraphHandlers(graph);
    const result = await handlers.graph_shortest_path({ from: 'chain-a.md', to: 'chain-c.md', direction: 'out' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(3);
  });
});

describe('graph_analyze', () => {
  it('finds orphan notes', async () => {
    const handlers = createGraphHandlers(graph);
    const result = await handlers.graph_analyze({ analysis: 'orphans' });
    const data = JSON.parse(result.content[0].text);
    expect(data.some((n: { path: string }) => n.path === 'orphan.md')).toBe(true);
  });

  it('finds hubs', async () => {
    const handlers = createGraphHandlers(graph);
    const result = await handlers.graph_analyze({ analysis: 'hubs', limit: 5 });
    const data = JSON.parse(result.content[0].text);
    expect(data[0].path).toBe('hub-note.md');
  });

  it('finds connected components', async () => {
    const handlers = createGraphHandlers(graph);
    const result = await handlers.graph_analyze({ analysis: 'components' });
    const data = JSON.parse(result.content[0].text);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });
});

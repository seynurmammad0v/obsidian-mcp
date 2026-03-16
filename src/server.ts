import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { VaultGraphStore } from './graph/index.js';
import { readingToolDefs, createReadingHandlers } from './tools/reading.js';
import { graphToolDefs, createGraphHandlers } from './tools/graph.js';
import { writingToolDefs, createWritingHandlers } from './tools/writing.js';
import type { VaultConfig } from './types.js';
import type { VaultWatcher } from './vault/watcher.js';

export function createServer(
  graph: VaultGraphStore,
  vaultRoot: string,
  config: VaultConfig,
  watcher: VaultWatcher | null
): McpServer {
  const server = new McpServer({
    name: 'obsidian-mcp',
    version: '1.0.0',
  });

  const readDefs = readingToolDefs();
  const readHandlers = createReadingHandlers(graph, vaultRoot, config);
  server.tool(readDefs.vault_stats.name, readDefs.vault_stats.description, readHandlers.vault_stats);
  server.tool(readDefs.read_note.name, readDefs.read_note.description, readDefs.read_note.inputSchema, readHandlers.read_note);
  server.tool(readDefs.search_notes.name, readDefs.search_notes.description, readDefs.search_notes.inputSchema, readHandlers.search_notes);

  const gDefs = graphToolDefs();
  const gHandlers = createGraphHandlers(graph);
  server.tool(gDefs.graph_neighbors.name, gDefs.graph_neighbors.description, gDefs.graph_neighbors.inputSchema, gHandlers.graph_neighbors);
  server.tool(gDefs.graph_traverse.name, gDefs.graph_traverse.description, gDefs.graph_traverse.inputSchema, gHandlers.graph_traverse);
  server.tool(gDefs.graph_shortest_path.name, gDefs.graph_shortest_path.description, gDefs.graph_shortest_path.inputSchema, gHandlers.graph_shortest_path);
  server.tool(gDefs.graph_analyze.name, gDefs.graph_analyze.description, gDefs.graph_analyze.inputSchema, gHandlers.graph_analyze);

  const wDefs = writingToolDefs();
  const wHandlers = createWritingHandlers(graph, vaultRoot, watcher);
  server.tool(wDefs.create_note.name, wDefs.create_note.description, wDefs.create_note.inputSchema, wHandlers.create_note);
  server.tool(wDefs.patch_note.name, wDefs.patch_note.description, wDefs.patch_note.inputSchema, wHandlers.patch_note);
  server.tool(wDefs.move_note.name, wDefs.move_note.description, wDefs.move_note.inputSchema, wHandlers.move_note);
  server.tool(wDefs.delete_note.name, wDefs.delete_note.description, wDefs.delete_note.inputSchema, wHandlers.delete_note);
  server.tool(wDefs.manage_tags.name, wDefs.manage_tags.description, wDefs.manage_tags.inputSchema, wHandlers.manage_tags);

  return server;
}

# obsidian-mcp

MCP server that turns Obsidian vaults into AI-queryable knowledge graphs.

## Build & Test

```bash
npm install          # Install dependencies
npm run build        # Build with tsup → dist/index.js
npm test             # Run all tests (66 tests)
npm run dev -- --vault <path>  # Dev mode with tsx
```

## Architecture

- `src/vault/` — File parsing, scanning, watching
- `src/graph/` — In-memory graph (adjacency list), traversal, analysis
- `src/tools/` — MCP tool handlers (reading, graph, writing)
- `src/utils/` — Wikilink regex, frontmatter helpers
- `src/types.ts` — Shared interfaces
- `test/fixtures/vault/` — 12 .md files with known link structure

## Key Decisions

- In-memory graph rebuilt on startup (~1-3s for 1k notes)
- File watcher with self-write suppression (100ms debounce)
- No external database — just the filesystem
- Wikilink resolution uses Obsidian's shortest-unique-path convention
- stdio transport for Claude Desktop/Code integration

## 12 Tools

Reading: vault_stats, read_note, search_notes
Graph: graph_neighbors, graph_traverse, graph_shortest_path, graph_analyze
Writing: create_note, patch_note, move_note, delete_note, manage_tags

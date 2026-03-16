# Obsidian MCP Server — Design Spec

**Date:** 2026-03-16
**Status:** Draft
**Author:** smammadov + Claude

## Overview

An MCP server that turns any Obsidian vault into an AI-queryable knowledge graph. Differentiators over the 24+ existing Obsidian MCP servers:

1. **Graph-first** — BFS, shortest path, connected components, bridge detection via `[[wikilinks]]`
2. **Zero infrastructure** — No database, no Obsidian running, no API keys. Just `npx obsidian-mcp --vault ~/vault`
3. **Vault-agnostic** — Works with any existing vault. No required structure or frontmatter schema
4. **Backlink-aware writes** — `move_note` auto-updates all references across the vault
5. **Tiny footprint** — 4 runtime dependencies, ~200KB install

### What This Is NOT

- Not an Obsidian plugin (no Obsidian APIs, no REST bridge)
- Not a semantic/vector search engine (Claude IS the semantic layer)
- Not a sync tool (single-vault, local filesystem only)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Largest MCP ecosystem, npx distribution, SDK v1.27.1 stable |
| Architecture | In-memory graph | ~1-3s startup, instant queries, incremental updates via file watcher |
| Search | Tag/frontmatter filtering + keyword grep | Claude formulates queries intelligently; embeddings are unnecessary overhead |
| Vault structure | Agnostic | Works with any vault; optional `--init` for best-practices scaffold |
| Distribution | npx only | Covers 95% of users. Docker/plugin can come later |
| Tool count | 12 | Within 5-15 sweet spot. Read-heavy (3), graph (4), write (5) |

## Tool Design

### Reading & Discovery (3 tools)

#### `vault_stats`

Overview of the vault. No parameters.

**Returns:**
```json
{
  "totalNotes": 847,
  "totalTags": 124,
  "totalLinks": 2341,
  "orphanNotes": 23,
  "connectedComponents": 3,
  "topTags": [{"tag": "go", "count": 45}],
  "topHubs": [{"path": "patterns/retry.md", "linkCount": 18}]
}
```

#### `read_note`

Read a note's full content with parsed metadata and link context.

**Params:** `path` (string, required)

**Returns:**
```json
{
  "path": "practices/go-errors.md",
  "title": "Go Error Handling",
  "frontmatter": {"tags": ["go"], "severity": "critical"},
  "content": "# Go Error Handling\n...",
  "outLinks": ["patterns/retry.md", "patterns/circuit-breaker.md"],
  "inLinks": ["decisions/why-fiber.md"],
  "sections": ["Why", "Examples", "Related"]
}
```

Includes backlinks + outlinks so Claude can decide what to follow without a separate call.

#### `search_notes`

Combinable filters, all optional. Returns snippets, not full content.

**Params:**
- `tags` (string[], optional) — notes with ALL these tags
- `folder` (string, optional) — restrict to folder prefix
- `frontmatter` (Record<string, any>, optional) — match frontmatter field values
- `query` (string, optional) — keyword in content (only reads file content when used)
- `limit` (number, optional, default 20) — max results

**Returns:** Array of `{path, title, frontmatter, tags, snippet}`. Snippet is the matching line + surrounding context.

### Graph Traversal (4 tools)

#### `graph_neighbors`

Direct `[[links]]` and backlinks for a note.

**Params:**
- `path` (string, required)
- `direction` (`"in" | "out" | "both"`, default `"both"`)

**Returns:** Array of `{path, title, direction, tags}`.

#### `graph_traverse`

BFS or DFS from a starting note, N hops deep.

**Params:**
- `path` (string, required) — starting note
- `depth` (number, 1-10, default 3) — max hops
- `algorithm` (`"bfs" | "dfs"`, default `"bfs"`)
- `direction` (`"out" | "in" | "both"`, default `"out"`)
- `filter_tags` (string[], optional) — only traverse through notes with these tags

**Returns:** Tree of nodes with depth level.

#### `graph_shortest_path`

Shortest link chain between two notes.

**Params:**
- `from` (string, required)
- `to` (string, required)

**Returns:** Ordered array of `{path, title}` forming the shortest chain, or `null` if no path exists.

#### `graph_analyze`

Structural analysis of the vault graph.

**Params:**
- `analysis` (`"components" | "orphans" | "bridges" | "hubs"`, required)
- `limit` (number, optional, default 20) — for hubs, top N by connection count

**Returns:** Varies by analysis type:
- `components` — array of `{id, noteCount, notes: string[]}`
- `orphans` — array of `{path, title}`
- `bridges` — array of `{path, title, componentsSplit: number}`
- `hubs` — array of `{path, title, inLinks: number, outLinks: number, total: number}`

### Writing & Manipulation (5 tools)

#### `create_note`

Create a new note with content and optional frontmatter.

**Params:**
- `path` (string, required) — relative to vault root, creates parent dirs if needed
- `content` (string, required) — markdown content
- `frontmatter` (Record<string, any>, optional) — YAML frontmatter to prepend

**Returns:** `{created: true, path: string}`

**Error:** If file already exists, returns error suggesting `patch_note` instead.

#### `patch_note`

Surgical edits to existing notes.

**Params:**
- `path` (string, required)
- `mode` (`"append" | "prepend" | "replace_section"`, required)
- `content` (string, optional) — new markdown content
- `section` (string, optional) — target heading for `replace_section` mode
- `frontmatter` (Record<string, any>, optional) — merge into existing frontmatter (does not overwrite unmentioned fields)

**Returns:** `{patched: true, path: string}`

#### `move_note`

Rename/move a note and auto-update all backlinks across the vault.

**Params:**
- `oldPath` (string, required)
- `newPath` (string, required)

**Behavior:**
1. Moves file to new path
2. Scans ALL notes for `[[old-name]]` references (using in-memory graph, not filesystem)
3. Updates each reference to `[[new-name]]`
4. Updates graph node + edges

**Returns:** `{moved: true, updatedLinks: 14, updatedFiles: ["path1.md", "path2.md"]}`

#### `delete_note`

Delete a note with broken-link awareness.

**Params:**
- `path` (string, required)

**Behavior:**
1. Checks inLinks (backlinks) before deleting
2. Deletes the file
3. Removes node + edges from graph
4. Returns list of now-broken links

**Returns:** `{deleted: true, brokenLinks: [{from: "other-note.md", linkText: "deleted-note"}]}`

#### `manage_tags`

Bulk tag operations across one or multiple notes.

**Params:**
- `action` (`"add" | "remove" | "rename"`, required)
- `tag` (string, required) — the tag to operate on
- `newTag` (string, optional) — for rename action
- `paths` (string[], optional) — specific notes. If omitted, operates vault-wide (for rename)

**Behavior:**
- Tags in frontmatter `tags:` array AND inline `#tag` in content are both handled
- `rename` without `paths` does vault-wide rename (useful for taxonomy changes)

**Returns:** `{action: string, affectedNotes: number, files: string[]}`

## Architecture

### Project Structure

```
obsidian-mcp/
├── src/
│   ├── index.ts              # Entry point, CLI args, start server
│   ├── server.ts             # MCP server setup, tool registration
│   ├── vault/
│   │   ├── scanner.ts        # Full vault scan on startup
│   │   ├── watcher.ts        # chokidar file watcher, incremental updates
│   │   └── parser.ts         # Parse markdown: frontmatter, [[links]], tags, sections
│   ├── graph/
│   │   ├── index.ts          # Graph data structure (adjacency list)
│   │   ├── traversal.ts      # BFS, DFS, shortest path
│   │   └── analysis.ts       # Components, orphans, bridges, hubs
│   ├── tools/
│   │   ├── reading.ts        # vault_stats, read_note, search_notes
│   │   ├── graph.ts          # graph_neighbors, graph_traverse, graph_shortest_path, graph_analyze
│   │   └── writing.ts        # create_note, patch_note, move_note, delete_note, manage_tags
│   └── utils/
│       ├── frontmatter.ts    # YAML frontmatter parse/serialize
│       └── wikilinks.ts      # [[link]] regex, resolution, embed handling
├── test/
│   ├── unit/                 # Unit tests for parser, graph, wikilinks
│   ├── integration/          # Full server tests via MCP protocol
│   └── fixtures/vault/       # Test vault with known link structure
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── README.md
├── LICENSE                   # MIT
└── .gitignore
```

### Core Data Structures

```typescript
// A parsed note in the vault
interface VaultNode {
  path: string;                     // relative to vault root
  title: string;                    // first H1 or filename
  frontmatter: Record<string, any>; // parsed YAML
  tags: string[];                   // from frontmatter + inline #tags
  outLinks: string[];               // [[links]] this note contains
  inLinks: string[];                // notes that link TO this note (computed)
  sections: string[];               // H1/H2/H3 headings for patch_note targeting
}

// The graph is a Map keyed by relative path
type VaultGraph = Map<string, VaultNode>;
```

### Data Flow

**Startup:**
1. `scanner.ts` reads all `.md` files in vault (async, 50 concurrent)
2. `parser.ts` extracts frontmatter, `[[links]]`, `#tags`, heading sections per file
3. `graph/index.ts` builds adjacency list from parsed nodes, computes `inLinks`
4. `watcher.ts` starts monitoring for file changes

**Tool call (e.g. `graph_traverse`):**
1. `server.ts` receives MCP request, routes to `tools/graph.ts`
2. Tool handler validates params with Zod
3. `graph/traversal.ts` runs BFS on in-memory graph
4. Returns results to Claude

**File change detected:**
1. `watcher.ts` fires event (debounced 100ms)
2. `parser.ts` re-parses the changed file only
3. `graph/index.ts` updates that node + recomputes affected edges incrementally
4. ~2-5ms per file change

### Dependencies (4 runtime)

| Package | Purpose | Size |
|---------|---------|------|
| `@modelcontextprotocol/sdk` | MCP protocol | ~50KB |
| `gray-matter` | YAML frontmatter parsing | ~15KB |
| `chokidar` | File watching | ~30KB |
| `zod` | Input validation (SDK peer dep) | ~50KB |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Type checking |
| `vitest` | Test runner |
| `tsup` | Bundler (single dist/index.js output) |

## Configuration

### CLI (zero-config default)

```bash
npx obsidian-mcp --vault ~/my-obsidian-vault
```

### Optional config file `.obsidian-mcp.json` in vault root

```json
{
  "ignore": ["templates/", "daily-notes/", ".trash/"],
  "watchDebounce": 100,
  "maxTraversalDepth": 10,
  "maxSearchResults": 50
}
```

### MCP client configuration

**Claude Desktop:**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "obsidian-mcp", "--vault", "/path/to/vault"]
    }
  }
}
```

**Claude Code:**
```bash
claude mcp add obsidian -- npx -y obsidian-mcp --vault /path/to/vault
```

### Optional `--init` flag

Scaffolds a best-practices knowledge base vault:

```bash
npx obsidian-mcp --init ~/new-knowledge-base
```

Creates:
```
new-knowledge-base/
├── practices/
├── patterns/
├── decisions/
├── templates/
│   ├── practice.md    # Frontmatter template: tags, severity, applies_to
│   └── pattern.md     # Frontmatter template: tags, use_when, trade_offs
└── .obsidian-mcp.json
```

## Error Handling

### File Conflicts

User edits a note in Obsidian while Claude writes via `patch_note`:
- Watcher detects Obsidian's save first, updates graph
- Claude's write lands on the latest version (last-write-wins)
- No locking — acceptable for single-user vaults

### Broken Links

`[[note-that-doesnt-exist]]`:
- Stored as edges to a "phantom node" (path in graph but no file)
- `graph_traverse` skips phantom nodes by default
- `graph_analyze({ analysis: "orphans" })` reports phantom targets

### Large Vaults (10k+ notes)

- Scanner uses async file reads with concurrency limit (50 parallel)
- Graph ops are O(V+E) — BFS on 10k nodes / 50k edges takes <10ms
- `search_notes` scans metadata index in memory; only reads file content when `query` keyword param is used
- Results always paginated (default 20, configurable)

### Malformed Files

- Missing/invalid frontmatter → node gets empty frontmatter, still indexed for links/tags
- Binary files in vault → skipped (only `.md` files parsed)
- Circular links (`A→B→C→A`) → traversal tracks visited set, never loops

### Startup Failures

- Vault path doesn't exist → clear error message, exit with code 1
- No `.md` files found → warning logged, server starts with empty graph
- Permission denied on file → warning per file, skip and continue

## Testing Strategy

### Unit Tests (vitest)

- `parser.ts` — parse frontmatter, extract `[[links]]` (including aliases `[[link|display]]`), `![[embeds]]`, `#tags`, heading sections
- `graph/index.ts` — add/remove/update nodes, inLink computation
- `graph/traversal.ts` — BFS, DFS, shortest path on small fixture graphs
- `graph/analysis.ts` — connected components, bridges, hubs, orphans
- `wikilinks.ts` — edge cases: nested links, links in code blocks (ignored), links with special characters, embeds

### Integration Tests

- Create temp vault with 20-30 `.md` files with known link structure
- Start server, call each tool via MCP protocol, assert responses
- Test `move_note` backlink updates end-to-end
- Test `delete_note` broken link reporting
- Test watcher: create file → verify graph updates within debounce window

### Fixture Vault (checked into repo)

```
test/fixtures/vault/
├── hub-note.md              # Links to 5+ others
├── orphan.md                # Zero links in or out
├── chain-a.md               # Links to chain-b
├── chain-b.md               # Links to chain-c
├── chain-c.md               # End of chain
├── circular-a.md            # Links to circular-b
├── circular-b.md            # Links back to circular-a
├── tagged-go.md             # Tagged with #go
├── tagged-react.md          # Tagged with #react
├── with-frontmatter.md      # Rich YAML frontmatter
├── malformed.md             # Invalid frontmatter
└── has-embeds.md            # Contains ![[embed]] syntax
```

### Coverage Target

~80% on `parser.ts`, `graph/`, and `tools/`. Skip coverage on `index.ts` (CLI entry), `watcher.ts` (integration-tested).

## Package & Distribution

- **npm package:** `obsidian-mcp`
- **Binary:** `obsidian-mcp` via `bin` field in package.json
- **Install:** `npx -y obsidian-mcp --vault /path`
- **Build:** `tsup` bundles to single `dist/index.js` (~200KB)
- **License:** MIT
- **Node:** >=18

## Future Considerations (Not In Scope)

These are explicitly out of scope for v1 but may be added later:

- **Semantic/vector search** — local ONNX embeddings + sqlite-vec
- **Docker distribution** — for server/team deployments
- **Multi-vault support** — cross-vault queries
- **Obsidian plugin variant** — native plugin using Obsidian APIs
- **Dataview query parsing** — read rendered Dataview results
- **Transclusion resolution** — inline `![[embed]]` content in read results
- **Canvas file support** — parse `.canvas` JSON files as graph nodes

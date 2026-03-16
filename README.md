# obsidian-mcp

MCP server that turns any Obsidian vault into an AI-queryable knowledge graph.

**What makes this different from the 24+ existing Obsidian MCP servers:**

- **Graph-first** — BFS, shortest path, connected components, bridge detection via `[[wikilinks]]`
- **Zero infrastructure** — No database, no Obsidian running, no API keys
- **Vault-agnostic** — Works with any existing vault, no required structure
- **Backlink-aware writes** — `move_note` auto-updates all references across the vault
- **Tiny** — 4 runtime dependencies, ~42KB bundle

## Quick Start

```bash
npx obsidian-mcp --vault ~/my-obsidian-vault
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Claude Code

```bash
claude mcp add obsidian -- npx -y obsidian-mcp --vault /path/to/vault
```

## Tools (12)

### Reading & Discovery

| Tool | Description |
|------|-------------|
| `vault_stats` | Overview: total notes, tags, links, orphans, components, top tags/hubs |
| `read_note` | Full content + frontmatter + links + backlinks + sections |
| `search_notes` | Filter by tags, folder, frontmatter, keyword. All combinable |

### Graph Traversal

| Tool | Description |
|------|-------------|
| `graph_neighbors` | Direct links + backlinks for a note |
| `graph_traverse` | BFS/DFS from a note, N hops deep with tag filtering |
| `graph_shortest_path` | Shortest link chain between two notes |
| `graph_analyze` | Components, orphans, bridges, hubs, dead links |

### Writing & Manipulation

| Tool | Description |
|------|-------------|
| `create_note` | Create with content + frontmatter |
| `patch_note` | Append, prepend, or replace a section. Update frontmatter |
| `move_note` | Rename/move + auto-update all backlinks across vault |
| `delete_note` | Delete + report broken links |
| `manage_tags` | Add/remove/rename tags (vault-wide rename supported) |

## Configuration

Zero-config by default. Optional `.obsidian-mcp.json` in vault root:

```json
{
  "ignore": ["templates/", "daily-notes/", ".trash/"],
  "watchDebounce": 100,
  "maxTraversalDepth": 10,
  "maxSearchResults": 500
}
```

### CLI Flags

```
--vault <path>       Path to Obsidian vault (required)
--verbose            Enable debug logging
--log-level <level>  error | warn | info | debug (default: info)
```

## How It Works

1. On startup, scans all `.md` files and builds an in-memory graph (~1-3s for 1k notes)
2. File watcher detects changes and updates the graph incrementally (~5ms per change)
3. Claude queries the graph via MCP tools — no re-scanning needed
4. Write operations update both the filesystem and the graph atomically

Hardcoded exclusions: `.obsidian/`, `.trash/`, `node_modules/`

## Development

```bash
npm install
npm test              # Run 66 tests
npm run build         # Build to dist/
npm run dev -- --vault test/fixtures/vault  # Dev mode
```

## License

MIT

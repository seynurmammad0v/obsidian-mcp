# Obsidian MCP Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that turns any Obsidian vault into an AI-queryable knowledge graph with 12 tools (read, graph traversal, write).

**Architecture:** In-memory graph built from vault `.md` files on startup. File watcher for incremental updates. stdio transport for Claude Desktop/Code integration.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk v1.27.1, gray-matter, chokidar, zod, vitest, tsup

**Spec:** `docs/superpowers/specs/2026-03-16-obsidian-mcp-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/index.ts` | CLI entry point, parse args, start server |
| `src/server.ts` | MCP server setup, register all 12 tools |
| `src/vault/parser.ts` | Parse single .md file → VaultNode (frontmatter, links, tags, sections) |
| `src/vault/scanner.ts` | Scan vault directory, parse all .md files concurrently |
| `src/vault/watcher.ts` | File watcher with debounce + self-write suppression |
| `src/graph/index.ts` | VaultGraph class: add/remove/update nodes, compute inLinks |
| `src/graph/traversal.ts` | BFS, DFS, shortest path algorithms |
| `src/graph/analysis.ts` | Connected components, orphans, bridges, hubs, dead_links |
| `src/tools/reading.ts` | vault_stats, read_note, search_notes tool handlers |
| `src/tools/graph.ts` | graph_neighbors, graph_traverse, graph_shortest_path, graph_analyze handlers |
| `src/tools/writing.ts` | create_note, patch_note, move_note, delete_note, manage_tags handlers |
| `src/utils/wikilinks.ts` | Wikilink regex, extraction, replacement for all link forms |
| `src/utils/frontmatter.ts` | YAML frontmatter parse/serialize via gray-matter |
| `src/types.ts` | Shared TypeScript interfaces (VaultNode, VaultGraph, etc.) |
| `test/fixtures/vault/*.md` | 12 fixture markdown files with known link structure |
| `test/unit/parser.test.ts` | Parser unit tests |
| `test/unit/wikilinks.test.ts` | Wikilink regex/replacement tests |
| `test/unit/graph.test.ts` | Graph data structure tests |
| `test/unit/traversal.test.ts` | BFS, DFS, shortest path tests |
| `test/unit/analysis.test.ts` | Components, orphans, bridges, hubs, dead_links tests |
| `test/integration/tools.test.ts` | Full tool handler tests against fixture vault |

---

## Chunk 1: Project Scaffold + Types + Parser

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/types.ts`

- [ ] **Step 1: Initialize npm project**

```bash
cd ~/Desktop/ms/obsidian-mcp
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk zod gray-matter chokidar
npm install -D typescript vitest tsup @types/node
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Update package.json**

Add to `package.json`:
```json
{
  "type": "module",
  "bin": {
    "obsidian-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx src/index.ts"
  },
  "files": ["dist/"],
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 6: Create src/types.ts**

```typescript
export interface Section {
  heading: string;
  level: number;
  line: number;
}

export interface VaultNode {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  outLinks: string[];
  inLinks: string[];
  sections: Section[];
}

export type VaultGraph = Map<string, VaultNode>;

export interface VaultConfig {
  ignore: string[];
  watchDebounce: number;
  maxTraversalDepth: number;
  maxSearchResults: number;
}

export const DEFAULT_CONFIG: VaultConfig = {
  ignore: [],
  watchDebounce: 100,
  maxTraversalDepth: 10,
  maxSearchResults: 500,
};

export const HARDCODED_IGNORES = ['.obsidian', '.trash', 'node_modules'];
```

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore src/types.ts package-lock.json
git commit -m "feat: project scaffold with types and dependencies"
```

---

### Task 2: Wikilink utilities

**Files:**
- Create: `src/utils/wikilinks.ts`
- Test: `test/unit/wikilinks.test.ts`

- [ ] **Step 1: Write failing tests for wikilink extraction**

Create `test/unit/wikilinks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractWikilinks, replaceWikilink } from '../../src/utils/wikilinks.js';

describe('extractWikilinks', () => {
  it('extracts simple wikilinks', () => {
    const content = 'See [[note-a]] and [[note-b]]';
    expect(extractWikilinks(content)).toEqual(['note-a', 'note-b']);
  });

  it('extracts aliased wikilinks', () => {
    const content = 'See [[note-a|display text]]';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('extracts wikilinks with heading anchors', () => {
    const content = 'See [[note-a#heading]]';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('extracts wikilinks with anchor and alias', () => {
    const content = 'See [[note-a#heading|display]]';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('extracts embed links', () => {
    const content = 'Content: ![[embed-note]]';
    expect(extractWikilinks(content)).toEqual(['embed-note']);
  });

  it('ignores links inside code blocks', () => {
    const content = '```\n[[not-a-link]]\n```\nBut [[real-link]]';
    expect(extractWikilinks(content)).toEqual(['real-link']);
  });

  it('ignores links inside inline code', () => {
    const content = 'Use `[[not-a-link]]` but see [[real-link]]';
    expect(extractWikilinks(content)).toEqual(['real-link']);
  });

  it('deduplicates links', () => {
    const content = '[[note-a]] and [[note-a]] again';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('handles path-form links', () => {
    const content = '[[folder/subfolder/note]]';
    expect(extractWikilinks(content)).toEqual(['folder/subfolder/note']);
  });

  it('returns empty array for no links', () => {
    expect(extractWikilinks('No links here')).toEqual([]);
  });
});

describe('replaceWikilink', () => {
  it('replaces simple wikilink', () => {
    const content = 'See [[old-name]] here';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name]] here');
  });

  it('preserves alias text', () => {
    const content = 'See [[old-name|My Link]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name|My Link]]');
  });

  it('preserves heading anchor', () => {
    const content = 'See [[old-name#heading]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name#heading]]');
  });

  it('preserves anchor and alias', () => {
    const content = 'See [[old-name#heading|display]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name#heading|display]]');
  });

  it('replaces embed links', () => {
    const content = '![[old-name]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('![[new-name]]');
  });

  it('replaces all occurrences', () => {
    const content = '[[old-name]] and [[old-name|alias]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('[[new-name]] and [[new-name|alias]]');
  });

  it('does not replace inside code blocks', () => {
    const content = '```\n[[old-name]]\n```\n[[old-name]]';
    const result = replaceWikilink(content, 'old-name', 'new-name');
    expect(result).toBe('```\n[[old-name]]\n```\n[[new-name]]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/wikilinks.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement wikilinks.ts**

Create `src/utils/wikilinks.ts`:

```typescript
const WIKILINK_REGEX = /!?\[\[([^\]]+)\]\]/g;
const FENCED_CODE_BLOCK = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`]+`/g;

function stripCodeBlocks(content: string): string {
  return content.replace(FENCED_CODE_BLOCK, (match) => ' '.repeat(match.length));
}

function stripInlineCode(content: string): string {
  return content.replace(INLINE_CODE, (match) => ' '.repeat(match.length));
}

function parseLinkTarget(raw: string): string {
  // Remove alias: [[target|alias]] → target
  const withoutAlias = raw.split('|')[0];
  // Remove anchor: [[target#heading]] → target
  const withoutAnchor = withoutAlias.split('#')[0];
  return withoutAnchor.trim();
}

export function extractWikilinks(content: string): string[] {
  const stripped = stripInlineCode(stripCodeBlocks(content));
  const links = new Set<string>();

  let match: RegExpExecArray | null;
  const regex = new RegExp(WIKILINK_REGEX.source, 'g');
  while ((match = regex.exec(stripped)) !== null) {
    const target = parseLinkTarget(match[1]);
    if (target) {
      links.add(target);
    }
  }

  return Array.from(links);
}

export function replaceWikilink(
  content: string,
  oldTarget: string,
  newTarget: string
): string {
  // Build a map of code block ranges to skip
  const codeRanges: Array<[number, number]> = [];

  const fencedRegex = new RegExp(FENCED_CODE_BLOCK.source, 'gm');
  let fencedMatch: RegExpExecArray | null;
  while ((fencedMatch = fencedRegex.exec(content)) !== null) {
    codeRanges.push([fencedMatch.index, fencedMatch.index + fencedMatch[0].length]);
  }

  const inlineRegex = new RegExp(INLINE_CODE.source, 'g');
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineRegex.exec(content)) !== null) {
    codeRanges.push([inlineMatch.index, inlineMatch.index + inlineMatch[0].length]);
  }

  function isInCodeBlock(index: number): boolean {
    return codeRanges.some(([start, end]) => index >= start && index < end);
  }

  // Escape special regex characters in target
  const escaped = oldTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match all wikilink forms: [[old]], [[old|alias]], [[old#heading]], [[old#heading|alias]], ![[old]]
  const linkRegex = new RegExp(`(!?)\\[\\[${escaped}(#[^\\]|]*?)?(\\|[^\\]]*?)?\\]\\]`, 'g');

  let result = '';
  let lastIndex = 0;

  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(content)) !== null) {
    result += content.slice(lastIndex, linkMatch.index);

    if (isInCodeBlock(linkMatch.index)) {
      result += linkMatch[0]; // preserve original
    } else {
      const embed = linkMatch[1];     // ! or empty
      const anchor = linkMatch[2] || ''; // #heading or empty
      const alias = linkMatch[3] || '';  // |display or empty
      result += `${embed}[[${newTarget}${anchor}${alias}]]`;
    }

    lastIndex = linkMatch.index + linkMatch[0].length;
  }

  result += content.slice(lastIndex);
  return result;
}

export function extractInlineTags(content: string): string[] {
  const stripped = stripInlineCode(stripCodeBlocks(content));
  const tags = new Set<string>();
  // Match #tag but not inside links, not ##headings, not #123 (numbers only)
  const tagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(stripped)) !== null) {
    tags.add(match[1]);
  }

  return Array.from(tags);
}

export function basenameFromPath(linkPath: string): string {
  const parts = linkPath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/wikilinks.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/wikilinks.ts test/unit/wikilinks.test.ts
git commit -m "feat: wikilink extraction and replacement utilities"
```

---

### Task 3: Frontmatter utilities

**Files:**
- Create: `src/utils/frontmatter.ts`

- [ ] **Step 1: Implement frontmatter.ts**

```typescript
import matter from 'gray-matter';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  try {
    const { data, content } = matter(raw);
    return { data: data as Record<string, unknown>, content };
  } catch {
    // Malformed frontmatter — return empty data, full content
    return { data: {}, content: raw };
  }
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  content: string
): string {
  if (Object.keys(data).length === 0) {
    return content;
  }
  return matter.stringify(content, data);
}

export function mergeFrontmatter(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  return { ...existing, ...updates };
}

export function extractTagsFromFrontmatter(data: Record<string, unknown>): string[] {
  const tags = data.tags;
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === 'string');
  }
  if (typeof tags === 'string') {
    return [tags];
  }
  return [];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/frontmatter.ts
git commit -m "feat: frontmatter parse/serialize utilities"
```

---

### Task 4: Markdown parser

**Files:**
- Create: `src/vault/parser.ts`
- Test: `test/unit/parser.test.ts`

- [ ] **Step 1: Write failing tests for parser**

Create `test/unit/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMarkdownFile } from '../../src/vault/parser.js';

const BASIC_NOTE = `---
tags: [go, error-handling]
severity: critical
---

# Go Error Handling

Always wrap errors with context.

## Why

Bare errors lose call-site context.

## Related

See [[retry-pattern]] and [[circuit-breaker|CB Pattern]].

Also check #best-practice in [[logging-standards#setup]].
`;

describe('parseMarkdownFile', () => {
  it('parses frontmatter', () => {
    const node = parseMarkdownFile('practices/go-errors.md', BASIC_NOTE);
    expect(node.frontmatter).toEqual({ tags: ['go', 'error-handling'], severity: 'critical' });
  });

  it('extracts title from first H1', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.title).toBe('Go Error Handling');
  });

  it('falls back to filename for title', () => {
    const node = parseMarkdownFile('no-heading.md', 'No heading here');
    expect(node.title).toBe('no-heading');
  });

  it('extracts tags from frontmatter and inline', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.tags).toContain('go');
    expect(node.tags).toContain('error-handling');
    expect(node.tags).toContain('best-practice');
  });

  it('deduplicates tags', () => {
    const content = '---\ntags: [go]\n---\n#go';
    const node = parseMarkdownFile('test.md', content);
    const goCount = node.tags.filter(t => t === 'go').length;
    expect(goCount).toBe(1);
  });

  it('extracts outLinks from wikilinks', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.outLinks).toContain('retry-pattern');
    expect(node.outLinks).toContain('circuit-breaker');
    expect(node.outLinks).toContain('logging-standards');
  });

  it('extracts sections with level and line number', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.sections).toContainEqual(
      expect.objectContaining({ heading: 'Go Error Handling', level: 1 })
    );
    expect(node.sections).toContainEqual(
      expect.objectContaining({ heading: 'Why', level: 2 })
    );
    expect(node.sections).toContainEqual(
      expect.objectContaining({ heading: 'Related', level: 2 })
    );
  });

  it('sets path correctly', () => {
    const node = parseMarkdownFile('folder/note.md', '# Title');
    expect(node.path).toBe('folder/note.md');
  });

  it('handles malformed frontmatter gracefully', () => {
    const content = '---\ninvalid: yaml: :\n---\n# Title\n[[link]]';
    const node = parseMarkdownFile('bad.md', content);
    expect(node.title).toBe('Title');
    expect(node.outLinks).toContain('link');
  });

  it('initializes inLinks as empty', () => {
    const node = parseMarkdownFile('test.md', '# Test');
    expect(node.inLinks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/parser.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement parser.ts**

Create `src/vault/parser.ts`:

```typescript
import { parseFrontmatter, extractTagsFromFrontmatter } from '../utils/frontmatter.js';
import { extractWikilinks, extractInlineTags } from '../utils/wikilinks.js';
import type { VaultNode, Section } from '../types.js';

function extractTitle(content: string, path: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1].trim();
  }
  // Fallback: filename without extension
  const parts = path.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}

function extractSections(raw: string): Section[] {
  const sections: Section[] = [];
  const lines = raw.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      sections.push({
        heading: match[2].trim(),
        level: match[1].length,
        line: i + 1, // 1-indexed
      });
    }
  }

  return sections;
}

export function parseMarkdownFile(path: string, raw: string): VaultNode {
  const { data, content } = parseFrontmatter(raw);
  const fmTags = extractTagsFromFrontmatter(data);
  const inlineTags = extractInlineTags(content);
  const allTags = Array.from(new Set([...fmTags, ...inlineTags]));

  return {
    path,
    title: extractTitle(content, path),
    frontmatter: data,
    tags: allTags,
    outLinks: extractWikilinks(content),
    inLinks: [], // computed later by graph
    sections: extractSections(raw),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/parser.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vault/parser.ts test/unit/parser.test.ts
git commit -m "feat: markdown parser — frontmatter, wikilinks, tags, sections"
```

---

## Chunk 2: Graph Data Structure + Algorithms

### Task 5: Graph data structure

**Files:**
- Create: `src/graph/index.ts`
- Test: `test/unit/graph.test.ts`

- [ ] **Step 1: Write failing tests for VaultGraph**

Create `test/unit/graph.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { VaultGraphStore } from '../../src/graph/index.js';
import type { VaultNode } from '../../src/types.js';

function makeNode(path: string, outLinks: string[] = []): VaultNode {
  return {
    path,
    title: path.replace('.md', ''),
    frontmatter: {},
    tags: [],
    outLinks,
    inLinks: [],
    sections: [],
  };
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
    g.recomputeInLinks();

    // Update a to no longer link to b
    g.updateNode(makeNode('a.md', ['c']));
    g.addNode(makeNode('c.md', []));
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/graph.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement graph/index.ts**

Create `src/graph/index.ts`:

```typescript
import type { VaultNode } from '../types.js';

interface DeadLink {
  target: string;
  referencedBy: Array<{ path: string; linkText: string }>;
}

export class VaultGraphStore {
  private nodes: Map<string, VaultNode> = new Map();
  private basenameIndex: Map<string, string> = new Map(); // basename → full path

  get size(): number {
    return this.nodes.size;
  }

  addNode(node: VaultNode): void {
    this.nodes.set(node.path, node);
    this.updateBasenameIndex(node.path);
  }

  updateNode(node: VaultNode): void {
    this.nodes.set(node.path, node);
    this.updateBasenameIndex(node.path);
  }

  removeNode(path: string): void {
    this.nodes.delete(path);
    this.rebuildBasenameIndex();
  }

  getNode(path: string): VaultNode | undefined {
    return this.nodes.get(path);
  }

  allNodes(): VaultNode[] {
    return Array.from(this.nodes.values());
  }

  resolveLink(linkTarget: string): string | null {
    // Direct path match first
    if (this.nodes.has(linkTarget)) return linkTarget;
    if (this.nodes.has(linkTarget + '.md')) return linkTarget + '.md';

    // Basename match (Obsidian's shortest-unique-path)
    const basename = linkTarget.split('/').pop()?.replace(/\.md$/, '') || linkTarget;
    return this.basenameIndex.get(basename) || null;
  }

  recomputeInLinks(): void {
    // Clear all inLinks
    for (const node of this.nodes.values()) {
      node.inLinks = [];
    }

    // Rebuild inLinks from outLinks
    for (const node of this.nodes.values()) {
      for (const link of node.outLinks) {
        const resolvedPath = this.resolveLink(link);
        if (resolvedPath) {
          const target = this.nodes.get(resolvedPath);
          if (target && !target.inLinks.includes(node.path)) {
            target.inLinks.push(node.path);
          }
        }
      }
    }
  }

  getDeadLinks(): DeadLink[] {
    const deadMap = new Map<string, Array<{ path: string; linkText: string }>>();

    for (const node of this.nodes.values()) {
      for (const link of node.outLinks) {
        if (!this.resolveLink(link)) {
          if (!deadMap.has(link)) {
            deadMap.set(link, []);
          }
          deadMap.get(link)!.push({ path: node.path, linkText: link });
        }
      }
    }

    return Array.from(deadMap.entries()).map(([target, refs]) => ({
      target,
      referencedBy: refs,
    }));
  }

  private updateBasenameIndex(path: string): void {
    const basename = path.split('/').pop()?.replace(/\.md$/, '') || path;
    this.basenameIndex.set(basename, path);
  }

  private rebuildBasenameIndex(): void {
    this.basenameIndex.clear();
    for (const path of this.nodes.keys()) {
      this.updateBasenameIndex(path);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/graph.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/index.ts test/unit/graph.test.ts
git commit -m "feat: VaultGraphStore — add/remove/update nodes, inLinks, dead links"
```

---

### Task 6: Graph traversal algorithms

**Files:**
- Create: `src/graph/traversal.ts`
- Test: `test/unit/traversal.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/unit/traversal.test.ts`:

```typescript
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

// a → b → c (chain)
const chain = () => buildGraph([
  makeNode('a.md', ['b.md']),
  makeNode('b.md', ['c.md']),
  makeNode('c.md', []),
]);

// a ↔ b, b → c, c → d (diamond-ish)
const diamond = () => buildGraph([
  makeNode('a.md', ['b.md']),
  makeNode('b.md', ['a.md', 'c.md']),
  makeNode('c.md', ['d.md']),
  makeNode('d.md', []),
]);

describe('bfs', () => {
  it('traverses chain with depth=1', () => {
    const result = bfs(chain(), 'a.md', 1, 'out');
    expect(result.nodes).toHaveLength(2); // a + b
    expect(result.nodes[0].depth).toBe(0);
    expect(result.nodes[1].depth).toBe(1);
  });

  it('traverses chain with depth=3', () => {
    const result = bfs(chain(), 'a.md', 3, 'out');
    expect(result.nodes).toHaveLength(3); // a, b, c
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
    const g = buildGraph([
      makeNode('a.md', []),
      makeNode('b.md', []),
    ]);
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/traversal.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement traversal.ts**

Create `src/graph/traversal.ts`:

```typescript
import type { VaultGraphStore } from './index.js';

type Direction = 'in' | 'out' | 'both';

interface TraversalNode {
  path: string;
  title: string;
  depth: number;
  tags: string[];
}

interface TraversalEdge {
  from: string;
  to: string;
}

interface TraversalResult {
  root: string;
  nodes: TraversalNode[];
  edges: TraversalEdge[];
}

interface PathNode {
  path: string;
  title: string;
}

function getNeighbors(
  graph: VaultGraphStore,
  path: string,
  direction: Direction
): string[] {
  const node = graph.getNode(path);
  if (!node) return [];

  const neighbors: string[] = [];

  if (direction === 'out' || direction === 'both') {
    for (const link of node.outLinks) {
      const resolved = graph.resolveLink(link);
      if (resolved) neighbors.push(resolved);
    }
  }

  if (direction === 'in' || direction === 'both') {
    neighbors.push(...node.inLinks);
  }

  return [...new Set(neighbors)];
}

export function bfs(
  graph: VaultGraphStore,
  startPath: string,
  maxDepth: number,
  direction: Direction,
  filterTags?: string[]
): TraversalResult {
  const visited = new Set<string>();
  const nodes: TraversalNode[] = [];
  const edges: TraversalEdge[] = [];
  const queue: Array<{ path: string; depth: number }> = [];

  const startNode = graph.getNode(startPath);
  if (!startNode) return { root: startPath, nodes: [], edges: [] };

  visited.add(startPath);
  queue.push({ path: startPath, depth: 0 });
  nodes.push({ path: startPath, title: startNode.title, depth: 0, tags: startNode.tags });

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const neighbors = getNeighbors(graph, path, direction);
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      const neighborNode = graph.getNode(neighbor);
      if (!neighborNode) continue;

      // Apply tag filter: the neighbor must have ALL filter tags (root is exempt)
      if (filterTags && filterTags.length > 0) {
        const hasAllTags = filterTags.every(t => neighborNode.tags.includes(t));
        if (!hasAllTags) continue;
      }

      visited.add(neighbor);
      nodes.push({ path: neighbor, title: neighborNode.title, depth: depth + 1, tags: neighborNode.tags });
      edges.push({ from: path, to: neighbor });
      queue.push({ path: neighbor, depth: depth + 1 });
    }
  }

  return { root: startPath, nodes, edges };
}

export function dfs(
  graph: VaultGraphStore,
  startPath: string,
  maxDepth: number,
  direction: Direction,
  filterTags?: string[]
): TraversalResult {
  const visited = new Set<string>();
  const nodes: TraversalNode[] = [];
  const edges: TraversalEdge[] = [];

  function visit(path: string, depth: number): void {
    if (visited.has(path) || depth > maxDepth) return;

    const node = graph.getNode(path);
    if (!node) return;

    visited.add(path);
    nodes.push({ path, title: node.title, depth, tags: node.tags });

    const neighbors = getNeighbors(graph, path, direction);
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;

      const neighborNode = graph.getNode(neighbor);
      if (!neighborNode) continue;

      if (filterTags && filterTags.length > 0) {
        const hasAllTags = filterTags.every(t => neighborNode.tags.includes(t));
        if (!hasAllTags) continue;
      }

      edges.push({ from: path, to: neighbor });
      visit(neighbor, depth + 1);
    }
  }

  visit(startPath, 0);
  return { root: startPath, nodes, edges };
}

export function shortestPath(
  graph: VaultGraphStore,
  fromPath: string,
  toPath: string,
  direction: Direction
): PathNode[] | null {
  if (fromPath === toPath) {
    const node = graph.getNode(fromPath);
    return node ? [{ path: node.path, title: node.title }] : null;
  }

  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [fromPath];
  visited.add(fromPath);

  while (queue.length > 0) {
    const current = queue.shift()!;

    const neighbors = getNeighbors(graph, current, direction);
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, current);

      if (neighbor === toPath) {
        // Reconstruct path
        const result: PathNode[] = [];
        let step: string | undefined = toPath;
        while (step !== undefined) {
          const node = graph.getNode(step);
          if (node) result.unshift({ path: node.path, title: node.title });
          step = parent.get(step);
        }
        return result;
      }

      queue.push(neighbor);
    }
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/traversal.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/traversal.ts test/unit/traversal.test.ts
git commit -m "feat: graph traversal — BFS, DFS, shortest path"
```

---

### Task 7: Graph analysis algorithms

**Files:**
- Create: `src/graph/analysis.ts`
- Test: `test/unit/analysis.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/unit/analysis.test.ts`:

```typescript
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
    // a → b → c (b is a bridge)
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/analysis.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement analysis.ts**

Create `src/graph/analysis.ts`:

```typescript
import type { VaultGraphStore } from './index.js';

interface OrphanResult {
  path: string;
  title: string;
}

interface HubResult {
  path: string;
  title: string;
  inLinks: number;
  outLinks: number;
  total: number;
}

interface ComponentResult {
  id: number;
  noteCount: number;
  notes: string[];
}

interface BridgeResult {
  path: string;
  title: string;
  componentsSplit: number;
}

interface DeadLinkResult {
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

      // Traverse both directions (undirected components)
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
  // For each node, test if removing it increases component count
  const baseComponents = findComponents(graph).length;
  const bridges: BridgeResult[] = [];
  const allNodes = graph.allNodes();

  for (const node of allNodes) {
    // Simulate removal: count components excluding this node
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/unit/analysis.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/analysis.ts test/unit/analysis.test.ts
git commit -m "feat: graph analysis — orphans, hubs, components, bridges, dead links"
```

---

## Chunk 3: Vault Scanner + Watcher

### Task 8: Vault scanner

**Files:**
- Create: `src/vault/scanner.ts`
- Create: `test/fixtures/vault/` (12 fixture files)

- [ ] **Step 1: Create test fixture vault**

Create these files in `test/fixtures/vault/`:

`hub-note.md`:
```markdown
---
tags: [architecture]
---
# Hub Note
Links to many: [[chain-a]], [[chain-b]], [[chain-c]], [[tagged-go]], [[tagged-react]], [[with-frontmatter]].
```

`orphan.md`:
```markdown
# Orphan
No links here. Totally isolated.
```

`chain-a.md`:
```markdown
# Chain A
Next: [[chain-b]]
```

`chain-b.md`:
```markdown
# Chain B
Next: [[chain-c]]
```

`chain-c.md`:
```markdown
# Chain C
End of the chain.
```

`circular-a.md`:
```markdown
# Circular A
See [[circular-b]]
```

`circular-b.md`:
```markdown
# Circular B
See [[circular-a]]
```

`tagged-go.md`:
```markdown
---
tags: [go, backend]
severity: critical
---
# Go Best Practices
Error handling is important. #error-handling
```

`tagged-react.md`:
```markdown
---
tags: [react, frontend]
---
# React Patterns
Use hooks. #hooks
```

`with-frontmatter.md`:
```markdown
---
tags: [go, patterns]
severity: high
applies_to: [api, microservices]
---
# Rich Frontmatter
## Why
This is important.
## Examples
Code here.
## Related
See [[tagged-go]] and [[hub-note]].
```

`malformed.md`:
```markdown
---
invalid: yaml: : :
---
# Malformed Note
Still has [[chain-a|a link]].
```

`has-embeds.md`:
```markdown
# Embeds
Embed: ![[chain-a]]
Regular: [[chain-b]]
```

- [ ] **Step 2: Implement scanner.ts**

Create `src/vault/scanner.ts`:

```typescript
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseMarkdownFile } from './parser.js';
import { VaultGraphStore } from '../graph/index.js';
import type { VaultConfig } from '../types.js';
import { HARDCODED_IGNORES } from '../types.js';

function shouldIgnore(relativePath: string, config: VaultConfig): boolean {
  const parts = relativePath.split('/');

  for (const part of parts) {
    if (HARDCODED_IGNORES.includes(part)) return true;
  }

  for (const pattern of config.ignore) {
    const clean = pattern.replace(/\/$/, '');
    if (relativePath.startsWith(clean + '/') || relativePath === clean) return true;
  }

  return false;
}

async function collectMarkdownFiles(
  dir: string,
  vaultRoot: string,
  config: VaultConfig
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(vaultRoot, fullPath);

    if (shouldIgnore(relPath, config)) continue;

    if (entry.isDirectory()) {
      const subFiles = await collectMarkdownFiles(fullPath, vaultRoot, config);
      files.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function scanVault(
  vaultRoot: string,
  config: VaultConfig
): Promise<VaultGraphStore> {
  const graph = new VaultGraphStore();
  const files = await collectMarkdownFiles(vaultRoot, vaultRoot, config);

  // Read files with concurrency limit
  const CONCURRENCY = 50;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const content = await readFile(filePath, 'utf-8');
          const relPath = relative(vaultRoot, filePath);
          return parseMarkdownFile(relPath, content);
        } catch {
          // Permission denied or read error — skip
          return null;
        }
      })
    );

    for (const node of results) {
      if (node) graph.addNode(node);
    }
  }

  graph.recomputeInLinks();
  return graph;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/vault/scanner.ts test/fixtures/vault/
git commit -m "feat: vault scanner with concurrent file reading + fixture vault"
```

---

### Task 9: File watcher

**Files:**
- Create: `src/vault/watcher.ts`

- [ ] **Step 1: Implement watcher.ts**

Create `src/vault/watcher.ts`:

```typescript
import { watch } from 'chokidar';
import { readFile, unlink } from 'node:fs/promises';
import { relative } from 'node:path';
import { parseMarkdownFile } from './parser.js';
import { VaultGraphStore } from '../graph/index.js';
import type { VaultConfig } from '../types.js';
import { HARDCODED_IGNORES } from '../types.js';

export class VaultWatcher {
  private suppressedPaths = new Set<string>();
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(
    private vaultRoot: string,
    private graph: VaultGraphStore,
    private config: VaultConfig
  ) {}

  suppressPath(path: string): void {
    this.suppressedPaths.add(path);
    setTimeout(() => {
      this.suppressedPaths.delete(path);
    }, this.config.watchDebounce + 50);
  }

  start(): void {
    const ignored = [
      ...HARDCODED_IGNORES.map(d => `**/${d}/**`),
      ...this.config.ignore.map(d => `**/${d.replace(/\/$/, '')}/**`),
    ];

    this.watcher = watch(this.vaultRoot, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.config.watchDebounce,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath) => this.handleChange(filePath));
    this.watcher.on('change', (filePath) => this.handleChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleDelete(filePath));
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private async handleChange(filePath: string): Promise<void> {
    if (!filePath.endsWith('.md')) return;

    const relPath = relative(this.vaultRoot, filePath);
    if (this.suppressedPaths.has(relPath)) return;

    try {
      const content = await readFile(filePath, 'utf-8');
      const node = parseMarkdownFile(relPath, content);
      this.graph.updateNode(node);
      this.graph.recomputeInLinks();
    } catch {
      // File might have been deleted between event and read
    }
  }

  private handleDelete(filePath: string): void {
    if (!filePath.endsWith('.md')) return;

    const relPath = relative(this.vaultRoot, filePath);
    if (this.suppressedPaths.has(relPath)) return;

    this.graph.removeNode(relPath);
    this.graph.recomputeInLinks();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/vault/watcher.ts
git commit -m "feat: file watcher with debounce and self-write suppression"
```

---

## Chunk 4: MCP Server + Tool Handlers

### Task 10: Reading tool handlers

**Files:**
- Create: `src/tools/reading.ts`

- [ ] **Step 1: Implement reading.ts**

Create `src/tools/reading.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { VaultGraphStore } from '../graph/index.js';
import { findOrphans, findComponents, findHubs, findDeadLinks } from '../graph/analysis.js';
import { parseFrontmatter } from '../utils/frontmatter.js';
import type { VaultConfig } from '../types.js';

export function readingToolDefs() {
  return {
    vault_stats: {
      description: 'Get an overview of the vault: total notes, tags, links, orphans, components, top tags, and top hubs.',
      inputSchema: z.object({}),
    },
    read_note: {
      description: 'Read a note\'s full content with parsed frontmatter, links, backlinks, and section headings.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the note (e.g. "practices/go-errors.md")'),
      }),
    },
    search_notes: {
      description: 'Search notes by tags, folder, frontmatter fields, and/or keyword in content. All filters are optional and combinable.',
      inputSchema: z.object({
        tags: z.array(z.string()).optional().describe('Notes must have ALL these tags'),
        folder: z.string().optional().describe('Restrict to notes in this folder prefix'),
        frontmatter: z.record(z.unknown()).optional().describe('Match frontmatter field values (shallow equality, array subset match)'),
        query: z.string().optional().describe('Keyword to search in note content'),
        limit: z.number().optional().default(20).describe('Max results (default 20)'),
      }),
    },
  };
}

export function createReadingHandlers(
  graph: VaultGraphStore,
  vaultRoot: string,
  config: VaultConfig
) {
  return {
    async vault_stats() {
      const nodes = graph.allNodes();
      const tagCounts = new Map<string, number>();
      let totalLinks = 0;

      for (const node of nodes) {
        totalLinks += node.outLinks.length;
        for (const tag of node.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }

      const topTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      const topHubs = findHubs(graph, 10).map(h => ({ path: h.path, linkCount: h.total }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            totalNotes: nodes.length,
            totalTags: tagCounts.size,
            totalLinks,
            orphanNotes: findOrphans(graph).length,
            deadLinks: findDeadLinks(graph).length,
            connectedComponents: findComponents(graph).length,
            topTags,
            topHubs,
          }, null, 2),
        }],
      };
    },

    async read_note({ path }: { path: string }) {
      const node = graph.getNode(path);
      if (!node) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${path}` }], isError: true };
      }

      let content: string;
      try {
        content = await readFile(join(vaultRoot, path), 'utf-8');
      } catch {
        return { content: [{ type: 'text' as const, text: `Error: Could not read file: ${path}` }], isError: true };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            path: node.path,
            title: node.title,
            frontmatter: node.frontmatter,
            content,
            outLinks: node.outLinks,
            inLinks: node.inLinks,
            sections: node.sections,
          }, null, 2),
        }],
      };
    },

    async search_notes({
      tags,
      folder,
      frontmatter,
      query,
      limit = 20,
    }: {
      tags?: string[];
      folder?: string;
      frontmatter?: Record<string, unknown>;
      query?: string;
      limit?: number;
    }) {
      let candidates = graph.allNodes();

      // Filter by folder
      if (folder) {
        const prefix = folder.endsWith('/') ? folder : folder + '/';
        candidates = candidates.filter(n => n.path.startsWith(prefix));
      }

      // Filter by tags (ALL must match)
      if (tags && tags.length > 0) {
        candidates = candidates.filter(n =>
          tags.every(t => n.tags.includes(t))
        );
      }

      // Filter by frontmatter
      if (frontmatter) {
        candidates = candidates.filter(n => {
          for (const [key, value] of Object.entries(frontmatter)) {
            const nodeVal = n.frontmatter[key];
            if (Array.isArray(value)) {
              if (!Array.isArray(nodeVal)) return false;
              if (!value.every(v => nodeVal.includes(v))) return false;
            } else if (Array.isArray(nodeVal)) {
              if (!nodeVal.includes(value)) return false;
            } else {
              if (nodeVal !== value) return false;
            }
          }
          return true;
        });
      }

      // Keyword search (reads from disk — only on filtered candidates)
      let results: Array<{ path: string; title: string; frontmatter: Record<string, unknown>; tags: string[]; snippet: string }> = [];

      if (query) {
        const maxScan = Math.min(candidates.length, config.maxSearchResults);
        const toScan = candidates.slice(0, maxScan);
        const queryLower = query.toLowerCase();

        for (const node of toScan) {
          try {
            const content = await readFile(join(vaultRoot, node.path), 'utf-8');
            const idx = content.toLowerCase().indexOf(queryLower);
            if (idx !== -1) {
              const start = Math.max(0, idx - 80);
              const end = Math.min(content.length, idx + query.length + 80);
              const snippet = (start > 0 ? '...' : '') + content.slice(start, end).trim() + (end < content.length ? '...' : '');
              results.push({ path: node.path, title: node.title, frontmatter: node.frontmatter, tags: node.tags, snippet });
            }
          } catch {
            // skip unreadable files
          }
          if (results.length >= limit) break;
        }
      } else {
        results = candidates.slice(0, limit).map(n => ({
          path: n.path,
          title: n.title,
          frontmatter: n.frontmatter,
          tags: n.tags,
          snippet: '',
        }));
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(results, null, 2),
        }],
      };
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/reading.ts
git commit -m "feat: reading tool handlers — vault_stats, read_note, search_notes"
```

---

### Task 11: Graph tool handlers

**Files:**
- Create: `src/tools/graph.ts`

- [ ] **Step 1: Implement graph tool handlers**

Create `src/tools/graph.ts`:

```typescript
import { z } from 'zod';
import { VaultGraphStore } from '../graph/index.js';
import { bfs, dfs, shortestPath } from '../graph/traversal.js';
import { findOrphans, findHubs, findComponents, findBridges, findDeadLinks } from '../graph/analysis.js';

export function graphToolDefs() {
  return {
    graph_neighbors: {
      description: 'Get direct [[links]] and backlinks for a note.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the note'),
        direction: z.enum(['in', 'out', 'both']).optional().default('both').describe('Link direction: in (backlinks), out (forward links), both'),
      }),
    },
    graph_traverse: {
      description: 'BFS or DFS traversal from a starting note, up to N hops deep. Returns flat node list with depth and edge list.',
      inputSchema: z.object({
        path: z.string().describe('Starting note path'),
        depth: z.number().min(1).max(10).optional().default(3).describe('Max hops (1-10, default 3)'),
        algorithm: z.enum(['bfs', 'dfs']).optional().default('bfs'),
        direction: z.enum(['in', 'out', 'both']).optional().default('out'),
        filter_tags: z.array(z.string()).optional().describe('Only traverse through notes with ALL these tags'),
      }),
    },
    graph_shortest_path: {
      description: 'Find the shortest link chain between two notes.',
      inputSchema: z.object({
        from: z.string().describe('Starting note path'),
        to: z.string().describe('Target note path'),
        direction: z.enum(['out', 'both']).optional().default('both').describe('"both" treats links as bidirectional; "out" follows only forward links'),
      }),
    },
    graph_analyze: {
      description: 'Structural analysis of the vault graph: connected components, orphan notes, bridge notes, hub notes, or dead links.',
      inputSchema: z.object({
        analysis: z.enum(['components', 'orphans', 'bridges', 'hubs', 'dead_links']).describe('Type of analysis'),
        limit: z.number().optional().default(20).describe('For hubs: top N by connection count'),
      }),
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
      path,
      depth = 3,
      algorithm = 'bfs',
      direction = 'out',
      filter_tags,
    }: {
      path: string;
      depth?: number;
      algorithm?: 'bfs' | 'dfs';
      direction?: 'in' | 'out' | 'both';
      filter_tags?: string[];
    }) {
      if (!graph.getNode(path)) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${path}` }], isError: true };
      }

      const result = algorithm === 'bfs'
        ? bfs(graph, path, depth, direction, filter_tags)
        : dfs(graph, path, depth, direction, filter_tags);

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },

    async graph_shortest_path({
      from,
      to,
      direction = 'both',
    }: {
      from: string;
      to: string;
      direction?: 'out' | 'both';
    }) {
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

    async graph_analyze({
      analysis,
      limit = 20,
    }: {
      analysis: 'components' | 'orphans' | 'bridges' | 'hubs' | 'dead_links';
      limit?: number;
    }) {
      let result: unknown;

      switch (analysis) {
        case 'components':
          result = findComponents(graph);
          break;
        case 'orphans':
          result = findOrphans(graph);
          break;
        case 'bridges':
          result = findBridges(graph);
          break;
        case 'hubs':
          result = findHubs(graph, limit);
          break;
        case 'dead_links':
          result = findDeadLinks(graph);
          break;
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/graph.ts
git commit -m "feat: graph tool handlers — neighbors, traverse, shortest_path, analyze"
```

---

### Task 12: Writing tool handlers

**Files:**
- Create: `src/tools/writing.ts`

- [ ] **Step 1: Implement writing tool handlers**

Create `src/tools/writing.ts`:

```typescript
import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { VaultGraphStore } from '../graph/index.js';
import { parseMarkdownFile } from '../vault/parser.js';
import { parseFrontmatter, serializeFrontmatter, mergeFrontmatter } from '../utils/frontmatter.js';
import { replaceWikilink, basenameFromPath } from '../utils/wikilinks.js';
import type { VaultWatcher } from '../vault/watcher.js';

export function writingToolDefs() {
  return {
    create_note: {
      description: 'Create a new note with content and optional frontmatter. Path must end in .md (appended if missing).',
      inputSchema: z.object({
        path: z.string().describe('Relative path for the new note'),
        content: z.string().describe('Markdown content'),
        frontmatter: z.record(z.unknown()).optional().describe('YAML frontmatter to prepend'),
      }),
    },
    patch_note: {
      description: 'Surgical edits: append, prepend, or replace a specific section. Can also update frontmatter independently.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the note'),
        mode: z.enum(['append', 'prepend', 'replace_section']).describe('Edit mode'),
        content: z.string().optional().describe('New markdown content (required for all modes)'),
        section: z.string().optional().describe('Target heading text (required for replace_section)'),
        frontmatter: z.record(z.unknown()).optional().describe('Merge into existing frontmatter'),
      }),
    },
    move_note: {
      description: 'Move/rename a note and auto-update all [[wikilinks]] referencing it across the vault.',
      inputSchema: z.object({
        oldPath: z.string().describe('Current relative path'),
        newPath: z.string().describe('New relative path'),
      }),
    },
    delete_note: {
      description: 'Delete a note and report which links will break.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to delete'),
      }),
    },
    manage_tags: {
      description: 'Add, remove, or rename tags across notes. For add/remove, paths is required. For rename, omit paths for vault-wide operation.',
      inputSchema: z.object({
        action: z.enum(['add', 'remove', 'rename']).describe('Tag operation'),
        tag: z.string().describe('The tag to operate on (without #)'),
        newTag: z.string().optional().describe('New tag name (for rename)'),
        paths: z.array(z.string()).optional().describe('Specific notes (required for add/remove)'),
      }),
    },
  };
}

export function createWritingHandlers(
  graph: VaultGraphStore,
  vaultRoot: string,
  watcher: VaultWatcher | null
) {
  function ensureMd(path: string): string {
    return path.endsWith('.md') ? path : path + '.md';
  }

  async function writeAndSuppress(relPath: string, content: string): Promise<void> {
    const fullPath = join(vaultRoot, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    if (watcher) watcher.suppressPath(relPath);
    await writeFile(fullPath, content, 'utf-8');
  }

  return {
    async create_note({
      path,
      content,
      frontmatter,
    }: {
      path: string;
      content: string;
      frontmatter?: Record<string, unknown>;
    }) {
      const notePath = ensureMd(path);

      if (graph.getNode(notePath)) {
        return { content: [{ type: 'text' as const, text: `Error: Note already exists: ${notePath}. Use patch_note to modify it.` }], isError: true };
      }

      const fileContent = frontmatter
        ? serializeFrontmatter(frontmatter, content)
        : content;

      await writeAndSuppress(notePath, fileContent);

      const node = parseMarkdownFile(notePath, fileContent);
      graph.addNode(node);
      graph.recomputeInLinks();

      return { content: [{ type: 'text' as const, text: JSON.stringify({ created: true, path: notePath }) }] };
    },

    async patch_note({
      path,
      mode,
      content,
      section,
      frontmatter,
    }: {
      path: string;
      mode: 'append' | 'prepend' | 'replace_section';
      content?: string;
      section?: string;
      frontmatter?: Record<string, unknown>;
    }) {
      if (!content && !frontmatter) {
        return { content: [{ type: 'text' as const, text: 'Error: At least one of content or frontmatter must be provided.' }], isError: true };
      }

      if (!content && mode) {
        return { content: [{ type: 'text' as const, text: 'Error: content is required for append/prepend/replace_section modes.' }], isError: true };
      }

      if (mode === 'replace_section' && !section) {
        return { content: [{ type: 'text' as const, text: 'Error: section is required for replace_section mode.' }], isError: true };
      }

      const node = graph.getNode(path);
      if (!node) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${path}` }], isError: true };
      }

      let raw: string;
      try {
        raw = await readFile(join(vaultRoot, path), 'utf-8');
      } catch {
        return { content: [{ type: 'text' as const, text: `Error: Could not read file: ${path}` }], isError: true };
      }

      const parsed = parseFrontmatter(raw);
      let bodyContent = parsed.content;

      if (content) {
        if (mode === 'append') {
          bodyContent = bodyContent.trimEnd() + '\n\n' + content;
        } else if (mode === 'prepend') {
          bodyContent = content + '\n\n' + bodyContent.trimStart();
        } else if (mode === 'replace_section') {
          const lines = bodyContent.split('\n');
          let sectionStart = -1;
          let sectionLevel = 0;
          let sectionEnd = lines.length;

          for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
            if (match && match[2].trim() === section && sectionStart === -1) {
              sectionStart = i;
              sectionLevel = match[1].length;
              continue;
            }
            if (sectionStart !== -1 && match && match[1].length <= sectionLevel) {
              sectionEnd = i;
              break;
            }
          }

          if (sectionStart === -1) {
            const available = node.sections.map(s => s.heading).join(', ');
            return {
              content: [{ type: 'text' as const, text: `Error: Section "${section}" not found. Available sections: ${available}` }],
              isError: true,
            };
          }

          // Preserve heading line, replace content beneath
          const before = lines.slice(0, sectionStart + 1);
          const after = lines.slice(sectionEnd);
          bodyContent = [...before, content, ...after].join('\n');
        }
      }

      const finalFrontmatter = frontmatter
        ? mergeFrontmatter(parsed.data, frontmatter)
        : parsed.data;

      const finalContent = serializeFrontmatter(finalFrontmatter, bodyContent);
      await writeAndSuppress(path, finalContent);

      const updatedNode = parseMarkdownFile(path, finalContent);
      graph.updateNode(updatedNode);
      graph.recomputeInLinks();

      return { content: [{ type: 'text' as const, text: JSON.stringify({ patched: true, path }) }] };
    },

    async move_note({
      oldPath,
      newPath,
    }: {
      oldPath: string;
      newPath: string;
    }) {
      const newNotePath = ensureMd(newPath);
      const node = graph.getNode(oldPath);
      if (!node) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${oldPath}` }], isError: true };
      }

      // Move the file
      const oldFull = join(vaultRoot, oldPath);
      const newFull = join(vaultRoot, newNotePath);
      await mkdir(dirname(newFull), { recursive: true });
      if (watcher) {
        watcher.suppressPath(oldPath);
        watcher.suppressPath(newNotePath);
      }
      await rename(oldFull, newFull);

      // Update backlinks in all referencing notes
      const oldBasename = basenameFromPath(oldPath);
      const newBasename = basenameFromPath(newNotePath);
      const updatedFiles: string[] = [];

      for (const inLinkPath of node.inLinks) {
        const refNode = graph.getNode(inLinkPath);
        if (!refNode) continue;

        try {
          let refContent = await readFile(join(vaultRoot, inLinkPath), 'utf-8');
          const updated = replaceWikilink(refContent, oldBasename, newBasename);
          if (updated !== refContent) {
            if (watcher) watcher.suppressPath(inLinkPath);
            await writeFile(join(vaultRoot, inLinkPath), updated, 'utf-8');
            updatedFiles.push(inLinkPath);

            // Re-parse updated file
            const updatedNode = parseMarkdownFile(inLinkPath, updated);
            graph.updateNode(updatedNode);
          }
        } catch {
          // skip unreadable files
        }
      }

      // Update graph: remove old, add new
      graph.removeNode(oldPath);
      try {
        const newContent = await readFile(newFull, 'utf-8');
        const newNode = parseMarkdownFile(newNotePath, newContent);
        graph.addNode(newNode);
      } catch {
        // shouldn't happen since we just renamed it
      }
      graph.recomputeInLinks();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ moved: true, updatedLinks: updatedFiles.length, updatedFiles }),
        }],
      };
    },

    async delete_note({ path }: { path: string }) {
      const node = graph.getNode(path);
      if (!node) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${path}` }], isError: true };
      }

      const brokenLinks = node.inLinks.map(inPath => ({
        from: inPath,
        linkText: basenameFromPath(path),
      }));

      if (watcher) watcher.suppressPath(path);
      await unlink(join(vaultRoot, path));

      graph.removeNode(path);
      graph.recomputeInLinks();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ deleted: true, brokenLinks }),
        }],
      };
    },

    async manage_tags({
      action,
      tag,
      newTag,
      paths,
    }: {
      action: 'add' | 'remove' | 'rename';
      tag: string;
      newTag?: string;
      paths?: string[];
    }) {
      if ((action === 'add' || action === 'remove') && (!paths || paths.length === 0)) {
        return { content: [{ type: 'text' as const, text: `Error: paths is required for ${action} action.` }], isError: true };
      }

      if (action === 'rename' && !newTag) {
        return { content: [{ type: 'text' as const, text: 'Error: newTag is required for rename action.' }], isError: true };
      }

      const targetPaths = paths || graph.allNodes().map(n => n.path);
      const affectedFiles: string[] = [];

      for (const notePath of targetPaths) {
        const node = graph.getNode(notePath);
        if (!node) continue;

        let raw: string;
        try {
          raw = await readFile(join(vaultRoot, notePath), 'utf-8');
        } catch {
          continue;
        }

        const parsed = parseFrontmatter(raw);
        let modified = false;

        // Handle frontmatter tags
        const fmTags: string[] = Array.isArray(parsed.data.tags) ? [...parsed.data.tags] : [];

        if (action === 'add' && !fmTags.includes(tag)) {
          fmTags.push(tag);
          parsed.data.tags = fmTags;
          modified = true;
        } else if (action === 'remove') {
          const idx = fmTags.indexOf(tag);
          if (idx !== -1) {
            fmTags.splice(idx, 1);
            parsed.data.tags = fmTags.length > 0 ? fmTags : undefined;
            if (parsed.data.tags === undefined) delete parsed.data.tags;
            modified = true;
          }
        } else if (action === 'rename') {
          const idx = fmTags.indexOf(tag);
          if (idx !== -1) {
            fmTags[idx] = newTag!;
            parsed.data.tags = fmTags;
            modified = true;
          }
        }

        // Handle inline tags
        let bodyContent = parsed.content;
        if (action === 'remove') {
          const inlineRegex = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'gm');
          const newBody = bodyContent.replace(inlineRegex, '$1');
          if (newBody !== bodyContent) {
            bodyContent = newBody;
            modified = true;
          }
        } else if (action === 'rename') {
          const inlineRegex = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'gm');
          const newBody = bodyContent.replace(inlineRegex, `$1#${newTag}`);
          if (newBody !== bodyContent) {
            bodyContent = newBody;
            modified = true;
          }
        }

        if (modified) {
          const newContent = serializeFrontmatter(parsed.data, bodyContent);
          await writeAndSuppress(notePath, newContent);

          const updatedNode = parseMarkdownFile(notePath, newContent);
          graph.updateNode(updatedNode);
          affectedFiles.push(notePath);
        }
      }

      graph.recomputeInLinks();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ action, affectedNotes: affectedFiles.length, files: affectedFiles }),
        }],
      };

      // local helper shared with writing handlers
      async function writeAndSuppress(relPath: string, content: string): Promise<void> {
        const fullPath = join(vaultRoot, relPath);
        await mkdir(dirname(fullPath), { recursive: true });
        if (watcher) watcher.suppressPath(relPath);
        await writeFile(fullPath, content, 'utf-8');
      }
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/writing.ts
git commit -m "feat: writing tool handlers — create, patch, move, delete, manage_tags"
```

---

## Chunk 5: MCP Server + CLI Entry Point

### Task 13: MCP server setup

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Implement server.ts**

Create `src/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VaultGraphStore } from './graph/index.js';
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

  // Register reading tools
  const readDefs = readingToolDefs();
  const readHandlers = createReadingHandlers(graph, vaultRoot, config);
  server.tool(readDefs.vault_stats.description, readDefs.vault_stats.inputSchema, readHandlers.vault_stats);
  server.tool(readDefs.read_note.description, readDefs.read_note.inputSchema, readHandlers.read_note);
  server.tool(readDefs.search_notes.description, readDefs.search_notes.inputSchema, readHandlers.search_notes);

  // Register graph tools
  const graphDefs = graphToolDefs();
  const graphHandlers = createGraphHandlers(graph);
  server.tool(graphDefs.graph_neighbors.description, graphDefs.graph_neighbors.inputSchema, graphHandlers.graph_neighbors);
  server.tool(graphDefs.graph_traverse.description, graphDefs.graph_traverse.inputSchema, graphHandlers.graph_traverse);
  server.tool(graphDefs.graph_shortest_path.description, graphDefs.graph_shortest_path.inputSchema, graphHandlers.graph_shortest_path);
  server.tool(graphDefs.graph_analyze.description, graphDefs.graph_analyze.inputSchema, graphHandlers.graph_analyze);

  // Register writing tools
  const writeDefs = writingToolDefs();
  const writeHandlers = createWritingHandlers(graph, vaultRoot, watcher);
  server.tool(writeDefs.create_note.description, writeDefs.create_note.inputSchema, writeHandlers.create_note);
  server.tool(writeDefs.patch_note.description, writeDefs.patch_note.inputSchema, writeHandlers.patch_note);
  server.tool(writeDefs.move_note.description, writeDefs.move_note.inputSchema, writeHandlers.move_note);
  server.tool(writeDefs.delete_note.description, writeDefs.delete_note.inputSchema, writeHandlers.delete_note);
  server.tool(writeDefs.manage_tags.description, writeDefs.manage_tags.inputSchema, writeHandlers.manage_tags);

  return server;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: MCP server with all 12 tools registered"
```

---

### Task 14: CLI entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement index.ts**

Create `src/index.ts`:

```typescript
#!/usr/bin/env node

import { resolve } from 'node:path';
import { readFile, access, stat } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { scanVault } from './vault/scanner.js';
import { VaultWatcher } from './vault/watcher.js';
import { createServer } from './server.js';
import { DEFAULT_CONFIG, type VaultConfig } from './types.js';

function parseArgs(args: string[]): { vault?: string; init?: string; verbose: boolean; logLevel: string } {
  let vault: string | undefined;
  let init: string | undefined;
  let verbose = false;
  let logLevel = 'info';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--vault' && args[i + 1]) {
      vault = args[++i];
    } else if (args[i] === '--init' && args[i + 1]) {
      init = args[++i];
    } else if (args[i] === '--verbose') {
      verbose = true;
    } else if (args[i] === '--log-level' && args[i + 1]) {
      logLevel = args[++i];
    }
  }

  return { vault, init, verbose, logLevel };
}

function log(level: string, message: string, currentLevel: string): void {
  const levels = ['error', 'warn', 'info', 'debug'];
  if (levels.indexOf(level) <= levels.indexOf(currentLevel)) {
    process.stderr.write(`[obsidian-mcp] [${level}] ${message}\n`);
  }
}

async function loadConfig(vaultRoot: string): Promise<VaultConfig> {
  const configPath = resolve(vaultRoot, '.obsidian-mcp.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function main(): Promise<void> {
  const { vault, init, verbose, logLevel } = parseArgs(process.argv.slice(2));
  const effectiveLogLevel = verbose ? 'debug' : logLevel;

  if (init) {
    // TODO: implement --init scaffold
    log('error', '--init is not yet implemented', effectiveLogLevel);
    process.exit(1);
  }

  if (!vault) {
    process.stderr.write('Usage: obsidian-mcp --vault <path>\n');
    process.exit(1);
  }

  const vaultRoot = resolve(vault);

  try {
    const stats = await stat(vaultRoot);
    if (!stats.isDirectory()) {
      log('error', `Not a directory: ${vaultRoot}`, effectiveLogLevel);
      process.exit(1);
    }
  } catch {
    log('error', `Vault path does not exist: ${vaultRoot}`, effectiveLogLevel);
    process.exit(1);
  }

  const config = await loadConfig(vaultRoot);
  log('info', `Scanning vault: ${vaultRoot}`, effectiveLogLevel);

  const graph = await scanVault(vaultRoot, config);
  log('info', `Indexed ${graph.size} notes`, effectiveLogLevel);

  const watcher = new VaultWatcher(vaultRoot, graph, config);
  watcher.start();
  log('info', 'File watcher started', effectiveLogLevel);

  const server = createServer(graph, vaultRoot, config, watcher);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'MCP server running on stdio', effectiveLogLevel);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it builds**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx tsup src/index.ts --format esm --clean
```

Expected: Build succeeds, `dist/index.js` created.

- [ ] **Step 3: Smoke test against fixture vault**

```bash
cd ~/Desktop/ms/obsidian-mcp && echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/index.js --vault test/fixtures/vault 2>/dev/null | head -1
```

Expected: JSON response with server capabilities.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: CLI entry point with arg parsing, vault scan, watcher, stdio transport"
```

---

## Chunk 6: Integration Tests + Polish

### Task 15: Integration tests

**Files:**
- Create: `test/integration/tools.test.ts`

- [ ] **Step 1: Write integration tests**

Create `test/integration/tools.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { scanVault } from '../../src/vault/scanner.js';
import { createReadingHandlers, readingToolDefs } from '../../src/tools/reading.js';
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
  it('traverses from chain-a to chain-c', async () => {
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
```

- [ ] **Step 2: Run integration tests**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run test/integration/tools.test.ts
```

Expected: All PASS.

- [ ] **Step 3: Run all tests**

```bash
cd ~/Desktop/ms/obsidian-mcp && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/integration/tools.test.ts
git commit -m "test: integration tests for all tool handlers against fixture vault"
```

---

### Task 16: CLAUDE.md + README

**Files:**
- Create: `CLAUDE.md`, `README.md`, `LICENSE`

- [ ] **Step 1: Create CLAUDE.md**

```markdown
# obsidian-mcp

MCP server that turns Obsidian vaults into AI-queryable knowledge graphs.

## Build & Test

```bash
npm install          # Install dependencies
npm run build        # Build with tsup
npm test             # Run all tests
npx vitest run       # Run tests once
```

## Architecture

- `src/vault/` — File parsing, scanning, watching
- `src/graph/` — In-memory graph (adjacency list), traversal, analysis
- `src/tools/` — MCP tool handlers (reading, graph, writing)
- `src/utils/` — Wikilink regex, frontmatter helpers
- `test/fixtures/vault/` — 12 .md files with known link structure

## Key Decisions

- In-memory graph rebuilt on startup (~1-3s for 1k notes)
- File watcher with self-write suppression (100ms debounce)
- No external database — just the filesystem
- Wikilink resolution uses Obsidian's shortest-unique-path convention
```

- [ ] **Step 2: Create README.md**

Write a README with: overview, install (`npx`), Claude Desktop config, Claude Code config, tool list, `--init` usage, configuration, contributing.

- [ ] **Step 3: Create LICENSE (MIT)**

- [ ] **Step 4: Final build + test**

```bash
cd ~/Desktop/ms/obsidian-mcp && npm run build && npm test
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md LICENSE
git commit -m "docs: add CLAUDE.md, README, and MIT license"
```

---

## Task Dependencies

```
Task 1 (scaffold) → Task 2 (wikilinks) → Task 3 (frontmatter) → Task 4 (parser)
                                                                       ↓
Task 5 (graph store) → Task 6 (traversal) → Task 7 (analysis)
                                                      ↓
Task 8 (scanner) → Task 9 (watcher)
                           ↓
Task 10 (reading tools) → Task 11 (graph tools) → Task 12 (writing tools)
                                                            ↓
Task 13 (server) → Task 14 (CLI entry) → Task 15 (integration tests) → Task 16 (docs)
```

All tasks are sequential — each builds on the previous. Total: ~16 tasks, ~80 steps.

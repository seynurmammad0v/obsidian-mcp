import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { VaultGraphStore } from '../graph/index.js';
import { findOrphans, findComponents, findHubs, findDeadLinks } from '../graph/analysis.js';
import type { VaultConfig } from '../types.js';

export function readingToolDefs() {
  return {
    vault_stats: {
      name: 'vault_stats',
      description: 'Get an overview of the vault: total notes, tags, links, orphans, components, top tags, and top hubs.',
      inputSchema: z.object({}),
    },
    read_note: {
      name: 'read_note',
      description: 'Read a note\'s full content with parsed frontmatter, links, backlinks, and section headings.',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the note (e.g. "practices/go-errors.md")'),
      }),
    },
    search_notes: {
      name: 'search_notes',
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
            tags: node.tags,
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

      if (folder) {
        const prefix = folder.endsWith('/') ? folder : folder + '/';
        candidates = candidates.filter(n => n.path.startsWith(prefix));
      }

      if (tags && tags.length > 0) {
        candidates = candidates.filter(n =>
          tags.every(t => n.tags.includes(t))
        );
      }

      if (frontmatter) {
        candidates = candidates.filter(n => {
          for (const [key, value] of Object.entries(frontmatter)) {
            const nodeVal = n.frontmatter[key];
            if (Array.isArray(value)) {
              if (!Array.isArray(nodeVal)) return false;
              if (!(value as unknown[]).every(v => (nodeVal as unknown[]).includes(v))) return false;
            } else if (Array.isArray(nodeVal)) {
              if (!(nodeVal as unknown[]).includes(value)) return false;
            } else {
              if (nodeVal !== value) return false;
            }
          }
          return true;
        });
      }

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
            // skip
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

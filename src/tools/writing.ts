import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import type { VaultGraphStore } from '../graph/index.js';
import { parseMarkdownFile } from '../vault/parser.js';
import { parseFrontmatter, serializeFrontmatter, mergeFrontmatter } from '../utils/frontmatter.js';
import { replaceWikilink, basenameFromPath } from '../utils/wikilinks.js';
import type { VaultWatcher } from '../vault/watcher.js';

export function writingToolDefs() {
  return {
    create_note: {
      name: 'create_note',
      description: 'Create a new note with content and optional frontmatter. Path must end in .md (appended if missing).',
      inputSchema: {
        path: z.string(),
        content: z.string(),
        frontmatter: z.record(z.unknown()).optional(),
      },
    },
    patch_note: {
      name: 'patch_note',
      description: 'Surgical edits: append, prepend, or replace a specific section. Can also update frontmatter independently.',
      inputSchema: {
        path: z.string(),
        mode: z.enum(['append', 'prepend', 'replace_section']),
        content: z.string().optional(),
        section: z.string().optional(),
        frontmatter: z.record(z.unknown()).optional(),
      },
    },
    move_note: {
      name: 'move_note',
      description: 'Move/rename a note and auto-update all [[wikilinks]] referencing it across the vault.',
      inputSchema: {
        oldPath: z.string(),
        newPath: z.string(),
      },
    },
    delete_note: {
      name: 'delete_note',
      description: 'Delete a note and report which links will break.',
      inputSchema: {
        path: z.string(),
      },
    },
    manage_tags: {
      name: 'manage_tags',
      description: 'Add, remove, or rename tags across notes. For add/remove, paths is required. For rename, omit paths for vault-wide.',
      inputSchema: {
        action: z.enum(['add', 'remove', 'rename']),
        tag: z.string(),
        newTag: z.string().optional(),
        paths: z.array(z.string()).optional(),
      },
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
    async create_note({ path, content, frontmatter }: { path: string; content: string; frontmatter?: Record<string, unknown> }) {
      const notePath = ensureMd(path);

      if (graph.getNode(notePath)) {
        return { content: [{ type: 'text' as const, text: `Error: Note already exists: ${notePath}. Use patch_note to modify it.` }], isError: true };
      }

      const fileContent = frontmatter ? serializeFrontmatter(frontmatter, content) : content;
      await writeAndSuppress(notePath, fileContent);

      const node = parseMarkdownFile(notePath, fileContent);
      graph.addNode(node);
      graph.recomputeInLinks();

      return { content: [{ type: 'text' as const, text: JSON.stringify({ created: true, path: notePath }) }] };
    },

    async patch_note({ path, mode, content, section, frontmatter }: {
      path: string; mode: 'append' | 'prepend' | 'replace_section';
      content?: string; section?: string; frontmatter?: Record<string, unknown>;
    }) {
      if (!content && !frontmatter) {
        return { content: [{ type: 'text' as const, text: 'Error: At least one of content or frontmatter must be provided.' }], isError: true };
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

          const before = lines.slice(0, sectionStart + 1);
          const after = lines.slice(sectionEnd);
          bodyContent = [...before, content, ...after].join('\n');
        }
      }

      const finalFrontmatter = frontmatter ? mergeFrontmatter(parsed.data, frontmatter) : parsed.data;
      const finalContent = serializeFrontmatter(finalFrontmatter, bodyContent);
      await writeAndSuppress(path, finalContent);

      const updatedNode = parseMarkdownFile(path, finalContent);
      graph.updateNode(updatedNode);
      graph.recomputeInLinks();

      return { content: [{ type: 'text' as const, text: JSON.stringify({ patched: true, path }) }] };
    },

    async move_note({ oldPath, newPath }: { oldPath: string; newPath: string }) {
      const newNotePath = ensureMd(newPath);
      const node = graph.getNode(oldPath);
      if (!node) {
        return { content: [{ type: 'text' as const, text: `Error: Note not found: ${oldPath}` }], isError: true };
      }

      const oldFull = join(vaultRoot, oldPath);
      const newFull = join(vaultRoot, newNotePath);
      await mkdir(dirname(newFull), { recursive: true });
      if (watcher) {
        watcher.suppressPath(oldPath);
        watcher.suppressPath(newNotePath);
      }
      await rename(oldFull, newFull);

      const oldBasename = basenameFromPath(oldPath);
      const newBasename = basenameFromPath(newNotePath);
      const updatedFiles: string[] = [];

      for (const inLinkPath of node.inLinks) {
        const refNode = graph.getNode(inLinkPath);
        if (!refNode) continue;

        try {
          const refContent = await readFile(join(vaultRoot, inLinkPath), 'utf-8');
          const updated = replaceWikilink(refContent, oldBasename, newBasename);
          if (updated !== refContent) {
            if (watcher) watcher.suppressPath(inLinkPath);
            await writeFile(join(vaultRoot, inLinkPath), updated, 'utf-8');
            updatedFiles.push(inLinkPath);

            const updatedNode = parseMarkdownFile(inLinkPath, updated);
            graph.updateNode(updatedNode);
          }
        } catch {
          // skip
        }
      }

      graph.removeNode(oldPath);
      try {
        const newContent = await readFile(newFull, 'utf-8');
        const newNode = parseMarkdownFile(newNotePath, newContent);
        graph.addNode(newNode);
      } catch {
        // shouldn't happen
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

    async manage_tags({ action, tag, newTag, paths }: {
      action: 'add' | 'remove' | 'rename'; tag: string; newTag?: string; paths?: string[];
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

        const fmTags: string[] = Array.isArray(parsed.data.tags) ? [...parsed.data.tags as string[]] : [];

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

        let bodyContent = parsed.content;
        if (action === 'remove' || action === 'rename') {
          const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const inlineRegex = new RegExp(`(^|\\s)#${escaped}(?=\\s|$)`, 'gm');
          const replacement = action === 'rename' ? `$1#${newTag}` : '$1';
          const newBody = bodyContent.replace(inlineRegex, replacement);
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
    },
  };
}

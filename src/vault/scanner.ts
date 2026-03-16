import { readdir, readFile } from 'node:fs/promises';
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

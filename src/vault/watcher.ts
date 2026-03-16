import { watch } from 'chokidar';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { parseMarkdownFile } from './parser.js';
import type { VaultGraphStore } from '../graph/index.js';
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

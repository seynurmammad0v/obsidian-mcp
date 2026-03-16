#!/usr/bin/env node

import { resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
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
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

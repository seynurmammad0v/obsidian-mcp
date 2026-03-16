#!/usr/bin/env node

import { resolve, join } from 'node:path';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
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

async function scaffoldVault(vaultPath: string, logLevel: string): Promise<void> {
  log('info', `Scaffolding knowledge base at: ${vaultPath}`, logLevel);

  const dirs = ['practices', 'patterns', 'decisions', 'templates'];
  for (const dir of dirs) {
    await mkdir(join(vaultPath, dir), { recursive: true });
  }

  await writeFile(join(vaultPath, '.obsidian-mcp.json'), JSON.stringify({
    ignore: ['templates/', '.trash/'],
    watchDebounce: 100,
    maxTraversalDepth: 10,
    maxSearchResults: 500,
  }, null, 2) + '\n');

  await writeFile(join(vaultPath, 'templates', 'practice.md'), `---
tags: []
severity: low  # low | medium | high | critical
applies_to: []
---

# Practice Name

Brief description of the practice.

## Why

Why this practice matters.

## Examples

\`\`\`
Code example here
\`\`\`

## Exceptions

When it's OK to skip this practice.

## Related

- [[related-practice]]
`);

  await writeFile(join(vaultPath, 'templates', 'pattern.md'), `---
tags: []
use_when: ""
trade_offs: ""
---

# Pattern Name

Brief description of the pattern.

## Problem

What problem does this solve?

## Solution

How to implement it.

## Trade-offs

Pros and cons of using this pattern.

## Related

- [[related-pattern]]
`);

  await writeFile(join(vaultPath, 'templates', 'decision.md'), `---
tags: []
status: proposed  # proposed | accepted | deprecated | superseded
date: ${new Date().toISOString().split('T')[0]}
---

# Decision: Title

## Context

What is the issue that we're seeing that is motivating this decision?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?

## Related

- [[related-decision]]
`);

  log('info', 'Created directories: practices/, patterns/, decisions/, templates/', logLevel);
  log('info', 'Created templates: practice.md, pattern.md, decision.md', logLevel);
  log('info', 'Created .obsidian-mcp.json', logLevel);
  log('info', `\nOpen ${vaultPath} in Obsidian to start building your knowledge base.`, logLevel);
}

async function main(): Promise<void> {
  const { vault, init, verbose, logLevel } = parseArgs(process.argv.slice(2));
  const effectiveLogLevel = verbose ? 'debug' : logLevel;

  if (init) {
    await scaffoldVault(resolve(init), effectiveLogLevel);
    process.exit(0);
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

import type { VaultNode } from '../types.js';

export interface DeadLink {
  target: string;
  referencedBy: Array<{ path: string; linkText: string }>;
}

export class VaultGraphStore {
  private nodes: Map<string, VaultNode> = new Map();
  private basenameIndex: Map<string, string> = new Map();

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
    if (this.nodes.has(linkTarget)) return linkTarget;
    if (this.nodes.has(linkTarget + '.md')) return linkTarget + '.md';

    const basename = linkTarget.split('/').pop()?.replace(/\.md$/, '') || linkTarget;
    return this.basenameIndex.get(basename) || null;
  }

  recomputeInLinks(): void {
    for (const node of this.nodes.values()) {
      node.inLinks = [];
    }

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

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

import { parseFrontmatter, extractTagsFromFrontmatter } from '../utils/frontmatter.js';
import { extractWikilinks, extractInlineTags } from '../utils/wikilinks.js';
import type { VaultNode, Section } from '../types.js';

function extractTitle(content: string, path: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1].trim();
  }
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
        line: i + 1,
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
    inLinks: [],
    sections: extractSections(content),
  };
}

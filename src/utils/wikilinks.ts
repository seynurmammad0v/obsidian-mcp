const FENCED_CODE_BLOCK = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`]+`/g;

function stripCodeBlocks(content: string): string {
  return content.replace(FENCED_CODE_BLOCK, (match) => ' '.repeat(match.length));
}

function stripInlineCode(content: string): string {
  return content.replace(INLINE_CODE, (match) => ' '.repeat(match.length));
}

function parseLinkTarget(raw: string): string {
  const withoutAlias = raw.split('|')[0];
  const withoutAnchor = withoutAlias.split('#')[0];
  return withoutAnchor.trim();
}

export function extractWikilinks(content: string): string[] {
  const stripped = stripInlineCode(stripCodeBlocks(content));
  const links = new Set<string>();
  const regex = /!?\[\[([^\]]+)\]\]/g;

  let match: RegExpExecArray | null;
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

  const escaped = oldTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRegex = new RegExp(`(!?)\\[\\[${escaped}(#[^\\]|]*?)?(\\|[^\\]]*?)?\\]\\]`, 'g');

  let result = '';
  let lastIndex = 0;

  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(content)) !== null) {
    result += content.slice(lastIndex, linkMatch.index);

    if (isInCodeBlock(linkMatch.index)) {
      result += linkMatch[0];
    } else {
      const embed = linkMatch[1];
      const anchor = linkMatch[2] || '';
      const alias = linkMatch[3] || '';
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

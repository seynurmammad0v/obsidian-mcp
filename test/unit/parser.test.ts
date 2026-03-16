import { describe, it, expect } from 'vitest';
import { parseMarkdownFile } from '../../src/vault/parser.js';

const BASIC_NOTE = `---
tags: [go, error-handling]
severity: critical
---

# Go Error Handling

Always wrap errors with context.

## Why

Bare errors lose call-site context.

## Related

See [[retry-pattern]] and [[circuit-breaker|CB Pattern]].

Also check #best-practice in [[logging-standards#setup]].
`;

describe('parseMarkdownFile', () => {
  it('parses frontmatter', () => {
    const node = parseMarkdownFile('practices/go-errors.md', BASIC_NOTE);
    expect(node.frontmatter).toEqual({ tags: ['go', 'error-handling'], severity: 'critical' });
  });

  it('extracts title from first H1', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.title).toBe('Go Error Handling');
  });

  it('falls back to filename for title', () => {
    const node = parseMarkdownFile('no-heading.md', 'No heading here');
    expect(node.title).toBe('no-heading');
  });

  it('extracts tags from frontmatter and inline', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.tags).toContain('go');
    expect(node.tags).toContain('error-handling');
    expect(node.tags).toContain('best-practice');
  });

  it('deduplicates tags', () => {
    const content = '---\ntags: [go]\n---\n#go';
    const node = parseMarkdownFile('test.md', content);
    const goCount = node.tags.filter(t => t === 'go').length;
    expect(goCount).toBe(1);
  });

  it('extracts outLinks from wikilinks', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.outLinks).toContain('retry-pattern');
    expect(node.outLinks).toContain('circuit-breaker');
    expect(node.outLinks).toContain('logging-standards');
  });

  it('extracts sections with level and line number', () => {
    const node = parseMarkdownFile('test.md', BASIC_NOTE);
    expect(node.sections).toContainEqual(
      expect.objectContaining({ heading: 'Go Error Handling', level: 1 })
    );
    expect(node.sections).toContainEqual(
      expect.objectContaining({ heading: 'Why', level: 2 })
    );
    expect(node.sections).toContainEqual(
      expect.objectContaining({ heading: 'Related', level: 2 })
    );
  });

  it('sets path correctly', () => {
    const node = parseMarkdownFile('folder/note.md', '# Title');
    expect(node.path).toBe('folder/note.md');
  });

  it('handles malformed frontmatter gracefully', () => {
    const content = '---\ninvalid: yaml: :\n---\n# Title\n[[link]]';
    const node = parseMarkdownFile('bad.md', content);
    expect(node.outLinks).toContain('link');
  });

  it('initializes inLinks as empty', () => {
    const node = parseMarkdownFile('test.md', '# Test');
    expect(node.inLinks).toEqual([]);
  });
});

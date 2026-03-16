import { describe, it, expect } from 'vitest';
import { extractWikilinks, replaceWikilink } from '../../src/utils/wikilinks.js';

describe('extractWikilinks', () => {
  it('extracts simple wikilinks', () => {
    const content = 'See [[note-a]] and [[note-b]]';
    expect(extractWikilinks(content)).toEqual(['note-a', 'note-b']);
  });

  it('extracts aliased wikilinks', () => {
    const content = 'See [[note-a|display text]]';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('extracts wikilinks with heading anchors', () => {
    const content = 'See [[note-a#heading]]';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('extracts wikilinks with anchor and alias', () => {
    const content = 'See [[note-a#heading|display]]';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('extracts embed links', () => {
    const content = 'Content: ![[embed-note]]';
    expect(extractWikilinks(content)).toEqual(['embed-note']);
  });

  it('ignores links inside code blocks', () => {
    const content = '```\n[[not-a-link]]\n```\nBut [[real-link]]';
    expect(extractWikilinks(content)).toEqual(['real-link']);
  });

  it('ignores links inside inline code', () => {
    const content = 'Use `[[not-a-link]]` but see [[real-link]]';
    expect(extractWikilinks(content)).toEqual(['real-link']);
  });

  it('deduplicates links', () => {
    const content = '[[note-a]] and [[note-a]] again';
    expect(extractWikilinks(content)).toEqual(['note-a']);
  });

  it('handles path-form links', () => {
    const content = '[[folder/subfolder/note]]';
    expect(extractWikilinks(content)).toEqual(['folder/subfolder/note']);
  });

  it('returns empty array for no links', () => {
    expect(extractWikilinks('No links here')).toEqual([]);
  });
});

describe('replaceWikilink', () => {
  it('replaces simple wikilink', () => {
    const content = 'See [[old-name]] here';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name]] here');
  });

  it('preserves alias text', () => {
    const content = 'See [[old-name|My Link]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name|My Link]]');
  });

  it('preserves heading anchor', () => {
    const content = 'See [[old-name#heading]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name#heading]]');
  });

  it('preserves anchor and alias', () => {
    const content = 'See [[old-name#heading|display]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('See [[new-name#heading|display]]');
  });

  it('replaces embed links', () => {
    const content = '![[old-name]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('![[new-name]]');
  });

  it('replaces all occurrences', () => {
    const content = '[[old-name]] and [[old-name|alias]]';
    expect(replaceWikilink(content, 'old-name', 'new-name')).toBe('[[new-name]] and [[new-name|alias]]');
  });

  it('does not replace inside code blocks', () => {
    const content = '```\n[[old-name]]\n```\n[[old-name]]';
    const result = replaceWikilink(content, 'old-name', 'new-name');
    expect(result).toBe('```\n[[old-name]]\n```\n[[new-name]]');
  });
});

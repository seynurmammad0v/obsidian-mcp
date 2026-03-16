import matter from 'gray-matter';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  try {
    const { data, content } = matter(raw);
    return { data: data as Record<string, unknown>, content };
  } catch {
    return { data: {}, content: raw };
  }
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  content: string
): string {
  if (Object.keys(data).length === 0) {
    return content;
  }
  return matter.stringify(content, data);
}

export function mergeFrontmatter(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>
): Record<string, unknown> {
  return { ...existing, ...updates };
}

export function extractTagsFromFrontmatter(data: Record<string, unknown>): string[] {
  const tags = data.tags;
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === 'string');
  }
  if (typeof tags === 'string') {
    return [tags];
  }
  return [];
}

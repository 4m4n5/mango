import type { SearchResult } from './types.js';

export function normalizeSearchQuery(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function validateSearchQuery(value: string): {
  display: string;
  normalized: string;
} {
  const display = value.trim().replace(/\s+/g, ' ');
  const normalized = normalizeSearchQuery(display);
  if (normalized.length < 2) {
    throw new Error('type at least 2 characters');
  }
  if (normalized.length > 120) {
    throw new Error('search is limited to 120 characters');
  }
  return { display, normalized };
}

export function scoreSearchMatch(
  title: string,
  query: string,
  searchableText = title,
): Pick<SearchResult, 'score' | 'match'> | null {
  const normalizedTitle = normalizeSearchQuery(title);
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedText = normalizeSearchQuery(searchableText);
  if (!normalizedTitle || !normalizedQuery) {
    return null;
  }
  if (normalizedTitle === normalizedQuery) {
    return { score: 100, match: 'exact' };
  }
  if (normalizedTitle.startsWith(normalizedQuery)) {
    return { score: 92, match: 'prefix' };
  }
  if (normalizedTitle.includes(normalizedQuery)) {
    return { score: 80, match: 'contains' };
  }
  const tokens = normalizedQuery.split(' ').filter((token) => token.length >= 2);
  if (tokens.length === 0 || !tokens.every((token) => normalizedText.includes(token))) {
    return null;
  }
  const titleMatches = tokens.filter((token) => normalizedTitle.includes(token)).length;
  return {
    score: 58 + Math.round((titleMatches / tokens.length) * 18),
    match: 'tokens',
  };
}

export function isDescriptiveSearchQuery(query: string): boolean {
  const normalized = normalizeSearchQuery(query);
  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.length >= 6
    || /\b(something|anything|movie|show|video|documentary|funny|relaxing|mood|like|about|with|where|that|feels)\b/
      .test(normalized);
}

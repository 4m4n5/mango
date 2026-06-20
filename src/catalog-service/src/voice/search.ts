import { searchVerifiedRailPoolTitles } from '../playability/db.js';
import { metahubPosterUrl, normalizePosterUrl } from '../poster.js';

export type VoiceSearchHit = {
  type: string;
  id: string;
  title: string;
  year?: string;
  poster?: string;
  tab: 'movies' | 'series' | 'live';
  score: number;
};

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Score title against query — higher is better; 0 means no match. */
export function scoreTitleMatch(title: string, query: string): number {
  const normalizedTitle = normalizeText(title);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || !normalizedTitle) {
    return 0;
  }
  if (normalizedTitle === normalizedQuery) {
    return 100;
  }
  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 92;
  }
  if (normalizedTitle.includes(normalizedQuery)) {
    return 78;
  }
  const words = normalizedQuery.split(' ').filter((word) => word.length >= 2);
  if (words.length === 0) {
    return 0;
  }
  const matched = words.filter((word) => normalizedTitle.includes(word)).length;
  if (matched === 0) {
    return 0;
  }
  return 45 + Math.round((matched / words.length) * 35);
}

function tabForType(type: string): VoiceSearchHit['tab'] {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'series') {
    return 'series';
  }
  if (normalized === 'tv') {
    return 'live';
  }
  return 'movies';
}

export async function searchVerifiedLibrary(
  query: string,
  limit = 8,
): Promise<VoiceSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const rows = await searchVerifiedRailPoolTitles(trimmed, 40);
  const seen = new Set<string>();
  const hits: VoiceSearchHit[] = [];
  for (const row of rows) {
    const key = `${row.type}:${row.id}`;
    if (seen.has(key)) {
      continue;
    }
    const score = scoreTitleMatch(row.title, trimmed);
    if (score <= 0) {
      continue;
    }
    seen.add(key);
    hits.push({
      type: row.type,
      id: row.id,
      title: row.title,
      year: row.year ?? undefined,
      poster: normalizePosterUrl(row.poster) ?? metahubPosterUrl(row.id) ?? undefined,
      tab: tabForType(row.type),
      score,
    });
  }

  hits.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.title.localeCompare(right.title);
  });
  return hits.slice(0, Math.max(1, limit));
}

import { searchVerifiedRailPoolTitles } from '../playability/db.js';
import { metahubPosterUrl, normalizePosterUrl } from '../poster.js';
import type { CatalogCore } from '../core.js';
import { searchLiveChannels } from './live-search.js';

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

/** True when the query is clearly aimed at live IPTV, not a VOD title. */
export function isLiveSearchIntent(query: string): boolean {
  const normalized = normalizeText(query);
  if (!normalized) {
    return false;
  }
  return /\b(live|iptv|channel|cartoons?|cricket|football|soccer|racing|news|sports?|espn|nick(?:elodeon)?|bbc|cnn|sky|star\s*sports|f1|formula\s*1|ndtv|wion|aaj\s+tak|abp\s+news|republic\s+bharat|al\s+jazeera|premier\s+league|la\s+liga|bundesliga|serie\s+a|ligue\s+1|champions\s+league|europa\s+league|put\s*on|tune\s*to)\b/i
    .test(normalized);
}

/**
 * IPTV pack / quality labels ("FRIENDS S01 4K", "FRIENDS ᴿᴬᵂ") that falsely
 * dominate VOD title search for short show names like "Friends".
 */
export function isIptvPackStyleTitle(title: string, query: string): boolean {
  const titleNorm = normalizeText(title);
  const queryNorm = normalizeText(query);
  if (!titleNorm || !queryNorm) {
    return false;
  }
  if (titleNorm === queryNorm) {
    return false;
  }
  const queryHasSeason = /\bs\d{1,2}\b/.test(queryNorm);
  const queryHasQuality = /\b(4k|uhd|raw|hdr)\b/.test(queryNorm);
  if (/\bs\d{1,2}\b/.test(titleNorm) && !queryHasSeason) {
    return true;
  }
  if (/\b(4k|uhd|raw|hdr)\b/.test(titleNorm) && !queryHasQuality) {
    return true;
  }
  // Superscript RAW / similar ornament markers common on IPTV packs.
  if (/[ᴿᴬᵂ]/.test(title) && !queryHasQuality) {
    return true;
  }
  return false;
}

/**
 * Merge verified VOD + live hits without letting IPTV pack names crowd out
 * (or fully replace) movie/series discovery.
 */
export function mergeLibraryAndLiveHits(
  vodHits: VoiceSearchHit[],
  liveHits: VoiceSearchHit[],
  query: string,
  limit: number,
): VoiceSearchHit[] {
  const cap = Math.max(1, limit);
  const liveIntent = isLiveSearchIntent(query);
  const filteredLive = liveHits.filter((hit) => {
    if (liveIntent) {
      return true;
    }
    // Non-live intent: only keep exact-ish channel names, never Sxx/4K packs.
    if (isIptvPackStyleTitle(hit.title, query)) {
      return false;
    }
    return hit.score >= 100 || normalizeText(hit.title) === normalizeText(query);
  });

  if (liveIntent) {
    const merged = [...vodHits, ...filteredLive];
    merged.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.title.localeCompare(right.title);
    });
    return merged.slice(0, cap);
  }

  // Title / open intent: VOD first, then at most two exact live channels.
  const liveSlots = Math.min(2, Math.max(0, cap - vodHits.length));
  const liveKept = filteredLive
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, liveSlots);
  const merged = [...vodHits, ...liveKept];
  merged.sort((left, right) => {
    const leftVod = left.tab !== 'live' ? 1 : 0;
    const rightVod = right.tab !== 'live' ? 1 : 0;
    if (rightVod !== leftVod) {
      return rightVod - leftVod;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.title.localeCompare(right.title);
  });
  return merged.slice(0, cap);
}

export async function searchVerifiedLibrary(
  query: string,
  limit = 8,
  core?: CatalogCore,
): Promise<VoiceSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  let rows = await searchVerifiedRailPoolTitles(trimmed, 40);
  if (rows.length === 0 && /\d/.test(trimmed)) {
    const base = trimmed.replace(/\s+\d+\s*$/, '').trim();
    if (base.length >= 2 && base !== trimmed) {
      rows = await searchVerifiedRailPoolTitles(base, 40);
    }
  }
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

  const liveHits = await searchLiveChannels(trimmed, limit, core, {
    validateUnknown: isLiveSearchIntent(trimmed),
  });
  return mergeLibraryAndLiveHits(hits, liveHits, trimmed, Math.max(1, limit));
}

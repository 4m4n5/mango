import type { Stream } from './core.js';

export type ParsedSeriesEpisodeId = {
  bare: string;
  season: number;
  episode: number;
};

const EPISODE_ID = /^(tt\d+):(\d+):(\d+)$/i;
const TITLE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'episode', 'ep', 'ft', 'feat', 'featuring',
]);
const SUPPLEMENTAL_HAYSTACK_RE = /\b(bonus|deleted|moments|featurette|bts|behind[\s-]?the[\s-]?scenes|extras?)\b/i;

export function parseSeriesEpisodeId(id: string): ParsedSeriesEpisodeId | null {
  const match = id.trim().match(EPISODE_ID);
  if (!match) {
    return null;
  }
  return {
    bare: match[1],
    season: Number(match[2]),
    episode: Number(match[3]),
  };
}

/** Indexers often publish Cinemeta S0 bonus rows under S1EN ids (IGL quirk). */
export function bonusIndexerAliasId(
  episodeId: string,
  maxEpisode = 6,
): string | null {
  const parsed = parseSeriesEpisodeId(episodeId);
  if (!parsed || parsed.season !== 0 || parsed.episode < 1 || parsed.episode > maxEpisode) {
    return null;
  }
  return `${parsed.bare}:1:${parsed.episode}`;
}

export function defaultMainSeasonProbeIds(bareId: string, maxEpisode = 12): string[] {
  const ids: string[] = [];
  for (let episode = 1; episode <= maxEpisode; episode += 1) {
    ids.push(`${bareId}:1:${episode}`);
  }
  return ids;
}

export function bonusEpisodeHaystack(stream: Stream): string {
  return `${stream.title || ''} ${stream.description || ''} ${stream.name || ''}`.toLowerCase();
}

export function streamMatchesBonusEpisodeNumber(haystack: string, episode: number): boolean {
  const variants = [String(episode), String(episode).padStart(2, '0')];
  for (const variant of variants) {
    const pattern = new RegExp(`\\bbonus\\s*(?:e|ep)?\\s*0*${variant}\\b`, 'i');
    if (pattern.test(haystack)) {
      return true;
    }
  }
  return false;
}

export function buildBonusTitleTokens(episodeTitle: string): string[] {
  const normalized = episodeTitle
    .toLowerCase()
    .replace(/[@#]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !TITLE_STOP_WORDS.has(token));
  return [...new Set(tokens)];
}

export function streamMatchesBonusEpisodeTitle(
  haystack: string,
  episodeTitle: string,
  episode: number,
): boolean {
  if (streamMatchesBonusEpisodeNumber(haystack, episode)) {
    return true;
  }
  if (!SUPPLEMENTAL_HAYSTACK_RE.test(haystack)) {
    return false;
  }
  const tokens = buildBonusTitleTokens(episodeTitle);
  if (tokens.length === 0) {
    return false;
  }
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  if (hits >= 2) {
    return true;
  }
  return hits === 1 && tokens[0].length >= 6;
}

export function streamMatchesBonusEpisode(
  stream: Stream,
  episode: number,
  episodeTitle: string | null,
): boolean {
  const haystack = bonusEpisodeHaystack(stream);
  if (streamMatchesBonusEpisodeNumber(haystack, episode)) {
    return true;
  }
  if (!episodeTitle) {
    return false;
  }
  return streamMatchesBonusEpisodeTitle(haystack, episodeTitle, episode);
}

export function dedupeStreamsByUrl(streams: Stream[]): Stream[] {
  const seen = new Set<string>();
  const kept: Stream[] = [];
  for (const stream of streams) {
    const url = typeof stream.url === 'string' ? stream.url.trim() : '';
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    kept.push(stream);
  }
  return kept;
}

export function listMainSeasonProbeIds(
  bareId: string,
  videos: Array<{ id?: string; season?: number; episode?: number }>,
  excludeId: string,
  limit = 16,
): string[] {
  const ids = videos
    .filter((video) => {
      const episodeId = typeof video.id === 'string' ? video.id.trim() : '';
      const season = Number(video.season);
      return episodeId
        && episodeId !== excludeId
        && Number.isFinite(season)
        && season >= 1;
    })
    .sort((left, right) => {
      const leftSeason = Number(left.season);
      const rightSeason = Number(right.season);
      if (leftSeason !== rightSeason) {
        return leftSeason - rightSeason;
      }
      return Number(left.episode) - Number(right.episode);
    })
    .map((video) => video.id as string);
  if (ids.length === 0) {
    return defaultMainSeasonProbeIds(bareId, Math.min(limit, 12));
  }
  return ids.slice(0, limit);
}

export function pickBonusStreamsFromCandidates(
  streams: Stream[],
  episode: number,
  episodeTitle: string | null,
): Stream[] {
  return dedupeStreamsByUrl(
    streams.filter((stream) => streamMatchesBonusEpisode(stream, episode, episodeTitle)),
  );
}

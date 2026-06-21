import type { Stream } from './core.js';

export type ParsedSeriesEpisodeId = {
  bare: string;
  season: number;
  episode: number;
};

export type BonusStreamMatchTier = 'strict' | 'relaxed';

const EPISODE_ID = /^(tt\d+):(\d+):(\d+)$/i;
const TITLE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'episode', 'ep', 'ft', 'feat', 'featuring',
]);
const SUPPLEMENTAL_HAYSTACK_RE = /\b(bonus|deleted|moments|featurette|bts|behind[\s-]?the[\s-]?scenes|extras?)\b/i;
/** Keep aligned with episodes.ts supplemental title routing. */
const SUPPLEMENTAL_EPISODE_TITLE_RE = /\b(behind the scenes|featurette|inside the episode|trailer|preview|making of|deleted scene|deleted|moments|bonus|extras?|bts)\b/i;

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

export function parsedSeasonRole(episodeId: string): 'main' | 'bonus' {
  const parsed = parseSeriesEpisodeId(episodeId);
  return parsed?.season === 0 ? 'bonus' : 'main';
}

export function isSupplementalEpisodeTitle(title: string): boolean {
  return SUPPLEMENTAL_EPISODE_TITLE_RE.test(title.toLowerCase());
}

/**
 * Indexers often publish Cinemeta S0 bonus rows under S{N}E{M} ids (same episode number).
 * Returns probe ids in season order — not an identity mapping.
 */
export function bonusIndexerProbeIds(
  episodeId: string,
  videos: Array<{ season?: number }> = [],
): string[] {
  const parsed = parseSeriesEpisodeId(episodeId);
  if (!parsed || parsed.season !== 0 || parsed.episode < 1) {
    return [];
  }
  const seasons = new Set<number>();
  for (const video of videos) {
    const season = Number(video.season);
    if (Number.isFinite(season) && season >= 1) {
      seasons.add(season);
    }
  }
  if (seasons.size === 0) {
    seasons.add(1);
  }
  return [...seasons].sort((left, right) => left - right).map(
    (season) => `${parsed.bare}:${season}:${parsed.episode}`,
  );
}

/** @deprecated Use bonusIndexerProbeIds — first id only. */
export function bonusIndexerAliasId(episodeId: string): string | null {
  return bonusIndexerProbeIds(episodeId)[0] ?? null;
}

export function defaultMainSeasonProbeIds(bareId: string, maxEpisode = 12): string[] {
  const ids: string[] = [];
  for (let episode = 1; episode <= maxEpisode; episode += 1) {
    ids.push(`${bareId}:1:${episode}`);
  }
  return ids;
}

function defaultEpisodeCrossProbeIds(
  bareId: string,
  target: ParsedSeriesEpisodeId,
  excludeId: string,
  limit: number,
): string[] {
  const ids: string[] = [];
  for (let season = 1; season <= 3; season += 1) {
    ids.push(`${bareId}:${season}:${target.episode}`);
  }
  for (let episode = 1; episode <= 12; episode += 1) {
    ids.push(`${bareId}:${target.season}:${episode}`);
  }
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of ids) {
    if (id === excludeId || seen.has(id)) {
      continue;
    }
    seen.add(id);
    kept.push(id);
  }
  return kept.slice(0, limit);
}

/**
 * Cross-probe order: same episode number (closest season first), then catalog peers.
 * Shared by main-line and bonus title fallback resolves.
 */
export function listEpisodeCrossProbeIds(
  bareId: string,
  videos: Array<{ id?: string; season?: number; episode?: number }>,
  target: ParsedSeriesEpisodeId,
  excludeId: string,
  limit = 24,
): string[] {
  const sameEpisode: string[] = [];
  const rest: string[] = [];
  for (const video of videos) {
    const id = typeof video.id === 'string' ? video.id.trim() : '';
    const season = Number(video.season);
    const episode = Number(video.episode);
    if (!id || id === excludeId || !Number.isFinite(season) || season < 1) {
      continue;
    }
    if (episode === target.episode) {
      sameEpisode.push(id);
    } else {
      rest.push(id);
    }
  }

  const seasonDistance = (left: string, right: string): number => {
    const pl = parseSeriesEpisodeId(left);
    const pr = parseSeriesEpisodeId(right);
    if (!pl || !pr) {
      return 0;
    }
    const dl = Math.abs(pl.season - target.season);
    const dr = Math.abs(pr.season - target.season);
    if (dl !== dr) {
      return dl - dr;
    }
    return pl.season - pr.season;
  };

  sameEpisode.sort(seasonDistance);
  rest.sort((left, right) => {
    const pl = parseSeriesEpisodeId(left);
    const pr = parseSeriesEpisodeId(right);
    if (!pl || !pr) {
      return 0;
    }
    if (pl.season !== pr.season) {
      return pl.season - pr.season;
    }
    return pl.episode - pr.episode;
  });

  const merged = [...sameEpisode, ...rest];
  if (merged.length > 0) {
    return merged.slice(0, limit);
  }
  return defaultEpisodeCrossProbeIds(bareId, target, excludeId, limit);
}

/** @deprecated Use listEpisodeCrossProbeIds with a parsed target episode. */
export function listMainSeasonProbeIds(
  bareId: string,
  videos: Array<{ id?: string; season?: number; episode?: number }>,
  excludeId: string,
  limit = 16,
): string[] {
  const parsed = parseSeriesEpisodeId(excludeId);
  if (!parsed) {
    return defaultMainSeasonProbeIds(bareId, Math.min(limit, 12));
  }
  return listEpisodeCrossProbeIds(bareId, videos, parsed, excludeId, limit);
}

export function bonusEpisodeHaystack(stream: Stream): string {
  return `${stream.title || ''} ${stream.description || ''} ${stream.name || ''}`.toLowerCase();
}

export function isSupplementalStreamHaystack(haystack: string): boolean {
  return SUPPLEMENTAL_HAYSTACK_RE.test(haystack);
}

export function isSupplementalStream(stream: Stream): boolean {
  return isSupplementalStreamHaystack(bonusEpisodeHaystack(stream));
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

/** True when release label names this main-line season/episode (S01E07, 1x07, Igl E07, …). */
export function streamMatchesMainEpisodeNumber(
  haystack: string,
  season: number,
  episode: number,
): boolean {
  const epVariants = [String(episode), String(episode).padStart(2, '0')];
  const seasonVariants = season > 0
    ? [String(season), String(season).padStart(2, '0')]
    : [];

  for (const ep of epVariants) {
    for (const s of seasonVariants) {
      if (new RegExp(`\\bs0*${s}[\\s._-]*e0*${ep}\\b`, 'i').test(haystack)) {
        return true;
      }
    }
    if (season === 1 && new RegExp(`\\b1[\\s._-]*x0*${ep}\\b`, 'i').test(haystack)) {
      return true;
    }
    if (new RegExp(`\\b(?:e|ep|episode)[\\s._-]*0*${ep}\\b`, 'i').test(haystack)) {
      return true;
    }
  }
  return false;
}

/** True when label names a different main-line episode (E07 while resolving E01). */
export function streamConflictsMainEpisodeNumber(
  haystack: string,
  season: number,
  episode: number,
  maxEpisode = 30,
): boolean {
  for (let other = 1; other <= maxEpisode; other += 1) {
    if (other === episode) {
      continue;
    }
    if (streamMatchesMainEpisodeNumber(haystack, season, other)) {
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

function titleTokenHits(haystack: string, episodeTitle: string): number {
  const tokens = buildBonusTitleTokens(episodeTitle);
  if (tokens.length === 0) {
    return 0;
  }
  return tokens.filter((token) => haystack.includes(token)).length;
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
  const hits = titleTokenHits(haystack, episodeTitle);
  if (hits >= 2) {
    return true;
  }
  const tokens = buildBonusTitleTokens(episodeTitle);
  return hits === 1 && tokens[0]?.length >= 6;
}

/**
 * Relaxed bonus match — meta title is supplemental; torrent may omit "bonus/deleted" keywords.
 * Rejects plain main-line labels that belong on a main-season row.
 */
export function streamMatchesBonusEpisodeTitleRelaxed(
  haystack: string,
  episodeTitle: string,
  episode: number,
): boolean {
  if (!isSupplementalEpisodeTitle(episodeTitle)) {
    return false;
  }
  if (streamMatchesBonusEpisodeNumber(haystack, episode)) {
    return true;
  }
  if (streamConflictsMainEpisodeNumber(haystack, 1, episode)) {
    return false;
  }
  if (
    streamMatchesMainEpisodeNumber(haystack, 1, episode)
    && !isSupplementalStreamHaystack(haystack)
  ) {
    return false;
  }
  const hits = titleTokenHits(haystack, episodeTitle);
  if (hits >= 2) {
    return true;
  }
  const tokens = buildBonusTitleTokens(episodeTitle);
  return hits === 1 && (tokens[0]?.length ?? 0) >= 6;
}

export function streamMatchesBonusEpisode(
  stream: Stream,
  episode: number,
  episodeTitle: string | null,
  tier: BonusStreamMatchTier = 'strict',
): boolean {
  const haystack = bonusEpisodeHaystack(stream);
  if (streamMatchesBonusEpisodeNumber(haystack, episode)) {
    return true;
  }
  if (!episodeTitle) {
    return false;
  }
  if (tier === 'relaxed') {
    return streamMatchesBonusEpisodeTitleRelaxed(haystack, episodeTitle, episode);
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

export function pickBonusStreamsFromCandidates(
  streams: Stream[],
  episode: number,
  episodeTitle: string | null,
  tier: BonusStreamMatchTier = 'strict',
): Stream[] {
  return dedupeStreamsByUrl(
    streams.filter((stream) => streamMatchesBonusEpisode(stream, episode, episodeTitle, tier)),
  );
}

/** Main-line partition — drops supplemental, bonus mislabels, and wrong-episode labels. */
export function pickMainEpisodeStreams(
  streams: Stream[],
  season: number,
  episode: number,
  options: { requireEpisodeLabel?: boolean } = {},
): Stream[] {
  const requireEpisodeLabel = options.requireEpisodeLabel === true;
  return dedupeStreamsByUrl(
    streams.filter((stream) => {
      const haystack = bonusEpisodeHaystack(stream);
      if (isSupplementalStreamHaystack(haystack)) {
        return false;
      }
      if (streamMatchesBonusEpisodeNumber(haystack, episode)) {
        return false;
      }
      if (streamConflictsMainEpisodeNumber(haystack, season, episode)) {
        return false;
      }
      if (requireEpisodeLabel && !streamMatchesMainEpisodeNumber(haystack, season, episode)) {
        return false;
      }
      return true;
    }),
  );
}

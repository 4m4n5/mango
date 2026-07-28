import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Stream } from './core.js';
import { isRateLimitedStreamUrl } from './catalog-errors.js';
import {
  buildDisplayLabel,
  parseFormatterDescription,
  textWithoutSubtitleLines,
} from './stream-formatter.js';
import { defaultPlayLadder, parsePlayLadder, splitLegacyPlayLadder, combinePlayLadders, type PlayLadderStep } from './play-ladder.js';

export type VerifiedStreamHint = {
  best_source?: string | null;
  cache_status?: string | null;
  debrid_service?: string | null;
  win_url_hash?: string | null;
  win_ladder_step?: string | null;
  probe_ms?: number | null;
};

export type QualityCap = '480p' | '720p' | '1080p' | '2160p';

/** Fields `streamPlayScore` actually reads — keep callers from inventing full filter configs. */
export type StreamPlayScoreConfig = {
  preferred_quality: QualityCap;
  max_quality: QualityCap | null;
  preferred_hdr_tags: string[];
  preferred_video_codecs: string[];
};

export type StreamFilterConfig = {
  /** Drop debrid streams that look uncached (default on). */
  exclude_uncached_debrid: boolean;
  /** Also drop debrid streams when cache status is unknown (stricter). */
  strict_unknown_cache: boolean;
  /** Drop streams above this resolution (helps Pi until M6.3 target-TV validation). */
  max_quality: QualityCap | null;
  /** Drop REMUX / Blu-ray remux style releases. */
  exclude_remux: boolean;
  /** Drop addon error placeholder streams (e.g. AIOStreams `[❌] TorBox Search`). */
  exclude_error_streams: boolean;
  /** Max streams returned from GET /stream (picker headroom). */
  stream_display_limit: number;
  /** Max candidate URLs to try during automatic Play. */
  auto_play_max_attempts: number;
  /** Hard wall-clock budget for automatic Play. */
  auto_play_wall_ms: number;
  /** Per-URL mpv probe budget. */
  auto_play_probe_ms: number;
  /** Longer probe budget for uncached TorBox ladder steps. */
  auto_play_uncached_probe_ms: number;
  /** Couch preferred quality target (ladder step 1). */
  preferred_quality: QualityCap;
  /** Optional HDR tag preference for 4K TV validation profiles. Empty means no HDR boost. */
  preferred_hdr_tags: string[];
  /** Optional codec preference. For Pi 5 4K, HEVC/x265 should outrank software-decoded codecs. */
  preferred_video_codecs: string[];
  /** Ordered play preference ladder — combined main + last_resort (compat). */
  play_ladder: import('./play-ladder.js').PlayLadderStep[];
  /** Smooth-only steps: grow/verify + Play priority + verified display. */
  main_ladder: import('./play-ladder.js').PlayLadderStep[];
  /** May stutter: Play fallback + unverified side-list when main empty. */
  last_resort_ladder: import('./play-ladder.js').PlayLadderStep[];
};

export type StreamFilterOverrides = {
  include_uncached?: boolean;
  strict_unknown_cache?: boolean;
  max_quality?: QualityCap | null;
  min_quality?: QualityCap | null;
  exclude_remux?: boolean;
  /** Hard filter for explicit language intent (e.g. Hindi only). */
  hard_language?: string | null;
  /** Soft preference for picker / play when set (e.g. Hindi, English). */
  preferred_language?: string | null;
};

export type StreamFilterMeta = {
  applied: StreamFilterConfig & { include_uncached: boolean };
  total: number;
  kept: number;
  /** Set when strict title tokens matched nothing but imdb-id / relaxed pass recovered streams. */
  title_filter_relaxed?: boolean;
  /** Set when couch play retried with 2160p + uncached after 1080p candidates failed. */
  quality_relaxed?: boolean;
  /** Ladder step used for GET /stream display filtering. */
  play_ladder_step?: string;
  /** GET /stream rows follow expandPlayLadder play order (not ideal-only). */
  play_ladder_preview?: boolean;
  /** GET /stream fell back to obligation-floor rows (Phase A empty). */
  obligation_floor_preview?: boolean;
  /** Truthful display-ladder population; counts unique candidates per stage. */
  stages?: {
    raw: number;
    integrity_safe: number;
    main: number;
    last_resort: number;
    obligation_floor: number;
  };
  excluded: {
    uncached_debrid: number;
    unknown_cache_debrid: number;
    above_max_quality: number;
    remux: number;
    error_stream: number;
    title_mismatch: number;
    series_pack_for_movie: number;
    language_mismatch: number;
  };
};

export type StreamFilterContext = {
  metaTitle?: string;
  /** Stremio/Cinemeta id (e.g. tt0111161) for torrent name matching. */
  metaId?: string;
  /** Original release/start year used to distinguish same-name remakes. */
  metaYear?: number;
  /** Origin country used for explicit edition qualifiers such as UK/US. */
  metaCountry?: string;
  /** Expected series episode title (e.g. Downsize, not Pilot). */
  episodeTitle?: string;
  contentType?: string;
  /** Expected main-feature runtime in minutes (from meta). */
  metaRuntimeMinutes?: number;
  /** Manual curation — skip title relevance filter for pinned couch titles. */
  skipTitleFilter?: boolean;
  /** Season-0 / BTS extras — allow short clips (deleted moments, etc.). */
  episodeRole?: 'main' | 'bonus';
};

const DEFAULT_FILTERS_PATH = '/etc/mango/catalog-filters.json';

const DEBRID_SERVICE_IDS = new Set([
  'realdebrid',
  'torbox',
  'premiumize',
  'debridlink',
  'alldebrid',
  'offcloud',
  'putio',
  'easydebrid',
  'pikpak',
]);

const QUALITY_ORDER: Record<QualityCap, number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '2160p': 2160,
};

function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function falsy(value: string | undefined): boolean {
  return value === '0' || value === 'false' || value === 'no';
}

function positiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function parseQualityCap(value: unknown): QualityCap | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === '4k') return '2160p';
  if (normalized in QUALITY_ORDER) return normalized as QualityCap;
  return null;
}

const TITLE_STOP_WORDS = new Set([
  'the', 'and', 'of', 'a', 'an', 'in', 'on', 'to', 'for', 'part',
  'files', 'file', 'story', 'love', 'home', 'night', 'dead', 'last',
  'kill', 'show', 'game', 'world', 'life', 'moon', 'star', 'man', 'men',
]);

function normalizeEditionAbbreviations(value: string): string {
  return value
    .replace(/\bU[\s._-]*S[\s._-]*A\b\.?/gi, ' USA ')
    .replace(/\bU[\s._-]*S\b\.?/gi, ' US ')
    .replace(/\bU[\s._-]*K\b\.?/gi, ' UK ');
}

function identityWords(value: string): string[] {
  return normalizeEditionAbbreviations(value)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Ordered content tokens for title identity (do not sort — order is the title). */
export function metaTitleTokensOrdered(metaTitle: string): string[] {
  return normalizeEditionAbbreviations(metaTitle)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !TITLE_STOP_WORDS.has(token));
}

function metaTitleTokens(metaTitle: string): string[] {
  return [...metaTitleTokensOrdered(metaTitle)].sort((left, right) => right.length - left.length);
}

function streamFilenameHaystack(stream: Stream): string {
  const hints = stream.behaviorHints;
  const filename = hints && typeof hints === 'object' && !Array.isArray(hints)
    && typeof (hints as Record<string, unknown>).filename === 'string'
    ? String((hints as Record<string, unknown>).filename)
    : '';
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function streamRelevanceHaystack(stream: Stream): string {
  const filename = streamFilenameHaystack(stream);
  return `${streamHaystack(stream)} ${filename}`.trim();
}

/** Raw release labels, ordered from the provider's strongest identity field. */
function streamIdentityLabels(stream: Stream): string[] {
  const labels: string[] = [];
  const add = (value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed && !labels.includes(trimmed)) labels.push(trimmed);
  };
  const description = typeof stream.description === 'string' ? stream.description : '';
  add(description.match(/📁\s*([^\n\r]+)/)?.[1]);
  const firstLine = description.split(/\r?\n/)[0]?.replace(/^📁\s*/, '').trim() || '';
  if (/(?:\bs\d{1,2}\s*[•·._\-\s]*e\s*\d{1,3}\b|\b\d{1,2}\s*x\s*\d{1,3}\b|\bep?\s*\d{1,3}\b)/i.test(firstLine)) add(firstLine);

  const hints = stream.behaviorHints;
  const filename = hints && typeof hints === 'object' && !Array.isArray(hints)
    && typeof (hints as Record<string, unknown>).filename === 'string'
    ? String((hints as Record<string, unknown>).filename)
    : '';
  add(filename);

  const label = `${stream.title || ''} ${stream.name || ''}`.trim();
  if (/(?:\bs\d{1,2}\s*[•·._\-\s]*e\s*\d{1,3}\b|\b\d{1,2}\s*x\s*\d{1,3}\b|\bep?\s*\d{1,3}\b)/i.test(label)) add(label);
  return labels;
}

/** Strip season/episode markers and years so the show name remains. */
function stripReleaseIdentityJunk(value: string): string {
  return normalizeEditionAbbreviations(value)
    // No trailing \b after ')' — end-of-string after a paren is not a word boundary.
    .replace(/\(\d{4}(?:\s*[–\-]\s*\d{4})?\)/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\bs\d{1,2}\s*[•·._\-\s]*e\s*\d{1,2}\b.*/i, ' ')
    .replace(/\bs\d{1,2}e\d{1,2}\b.*/i, ' ')
    .replace(/\b\d{1,2}\s*x\s*\d{1,2}\b.*/i, ' ')
    .replace(/\bep?\s*\d{1,3}\b.*/i, ' ')
    .replace(/\bseason\s*\d+\b.*/i, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|web-?dl|bluray|remux|hevc|x265|x264|av1|hdr|dovi|atmos)\b.*/i, ' ')
    .trim();
}

/**
 * Best-effort show label from 📁 description line or filename — used for
 * identity matching so "Your Friends And Neighbors" cannot pass as "Friends".
 */
export function extractReleaseShowTitle(stream: Stream): string | null {
  for (const label of streamIdentityLabels(stream)) {
    const cleaned = stripReleaseIdentityJunk(label.replace(/[._]/g, ' '));
    if (cleaned) return cleaned;
  }
  return null;
}

type Edition = 'uk' | 'us';

function editionForAlias(token: string): Edition | null {
  if (token === 'uk' || token === 'gb') return 'uk';
  if (token === 'us' || token === 'usa') return 'us';
  return null;
}

function metadataEdition(metaTitle: string, metaCountry?: string): Edition | null {
  const country = identityWords(metaCountry || '').join(' ');
  if (/\b(united kingdom|great britain|uk|gb)\b/.test(country)) return 'uk';
  if (/\b(united states|united states of america|us|usa)\b/.test(country)) return 'us';
  const titleWords = identityWords(metaTitle);
  if (titleWords.length > 1) {
    return editionForAlias(titleWords[titleWords.length - 1] || '');
  }
  return null;
}

function editionTokensForRelease(releaseTitle: string, metaTitle: string): Edition[] {
  const metaWords = new Set(identityWords(metaTitle));
  const editions = identityWords(releaseTitle)
    .filter((token) => !metaWords.has(token))
    .map(editionForAlias)
    .filter((edition): edition is Edition => edition !== null);
  return [...new Set(editions)];
}

function explicitReleaseYears(stream: Stream): Set<number> {
  const years = new Set<number>();
  for (const label of streamIdentityLabels(stream)) {
    const normalized = normalizeEditionAbbreviations(label);
    const episodeMarker = normalized.search(/\bs\d{1,2}\s*[•·._\-\s]*e\s*\d{1,3}\b/i);
    const identityPrefix = episodeMarker >= 0 ? normalized.slice(0, episodeMarker) : normalized;
    for (const match of identityPrefix.matchAll(/\b((?:19|20)\d{2})\b/g)) {
      years.add(Number(match[1]));
    }
  }
  return years;
}

const EPISODE_TECH_TOKEN_RE = /\b(?:19\d{2}|20\d{2}|2160p|1080p|720p|480p|4k|uhd|web(?:-?dl|rip)?|bluray|brrip|hdtv|dvdrip|remux|hevc|x26[45]|h26[45]|av1|hdr10?\+?|hdr|dovi|dv|atmos|aac|eac3|ac3|ddp?\d*|proper|repack|extended|multi|amzn|nf|atvp)\b/i;
const EPISODE_GENERIC_TOKENS = new Set([
  'episode', 'episodes', 'complete', 'uncut', 'finale', 'mkv', 'mp4', 'sample',
]);

function episodeIdentityTokens(value: string): string[] {
  return identityWords(value)
    .filter((token) => token.length >= 4 && !EPISODE_GENERIC_TOKENS.has(token));
}

function candidateEpisodeTitleTokens(stream: Stream): string[][] {
  const candidates: string[][] = [];
  for (const label of streamIdentityLabels(stream)) {
    const normalized = normalizeEditionAbbreviations(label);
    const marker = normalized.match(
      /(?:\bs\d{1,2}\s*[•·._\-\s]*e\s*\d{1,3}\b|\b\d{1,2}\s*x\s*\d{1,3}\b|\bep?\s*\d{1,3}\b)/i,
    );
    if (!marker || marker.index === undefined) continue;
    let tail = normalized.slice(marker.index + marker[0].length)
      .replace(/\.(?:mkv|mp4|avi)$/i, ' ')
      .replace(/^[\s._\-–—:]+/, ' ');
    const technical = tail.search(EPISODE_TECH_TOKEN_RE);
    if (technical >= 0) tail = tail.slice(0, technical);
    const tokens = episodeIdentityTokens(tail);
    if (tokens.length > 0 && tokens.length <= 8) candidates.push(tokens);
  }
  return candidates;
}

export type EpisodeIdentityMarker = {
  season: number | null;
  episode: number;
  strength: 'full' | 'bare';
};

function validEpisodeNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 999 ? parsed : null;
}

/** Parse the episode marker forms used by Stremio providers and release names. */
export function parseEpisodeIdentityMarker(value: string): EpisodeIdentityMarker | null {
  const full = value.match(/\bs\s*(\d{1,2})\s*[•·._\-\s]*e\s*(\d{1,3})\b/i)
    ?? value.match(/\b(\d{1,2})\s*x\s*(\d{1,3})\b/i);
  if (full) {
    const season = validEpisodeNumber(full[1]);
    const episode = validEpisodeNumber(full[2]);
    if (season !== null && episode !== null) {
      return { season, episode, strength: 'full' };
    }
  }
  const bare = value.match(/\b(?:ep|e)\s*[._\-\s]*(\d{1,3})\b/i);
  const episode = validEpisodeNumber(bare?.[1]);
  return episode === null ? null : { season: null, episode, strength: 'bare' };
}

function targetEpisodeIdentity(metaId?: string): EpisodeIdentityMarker | null {
  if (!metaId) return null;
  const parts = metaId.split(':');
  if (parts.length >= 3) {
    const season = validEpisodeNumber(parts[parts.length - 2]);
    const episode = validEpisodeNumber(parts[parts.length - 1]);
    if (season !== null && episode !== null) {
      return { season, episode, strength: 'full' };
    }
  }
  return parseEpisodeIdentityMarker(metaId);
}

function streamEpisodeMarkers(stream: Stream): EpisodeIdentityMarker[] {
  const markers: EpisodeIdentityMarker[] = [];
  for (const label of streamIdentityLabels(stream)) {
    const marker = parseEpisodeIdentityMarker(label);
    if (marker && !markers.some((entry) => (
      entry.season === marker.season && entry.episode === marker.episode
    ))) {
      markers.push(marker);
    }
  }
  return markers;
}

function streamEpisodeIdentityContradicts(stream: Stream, metaId?: string): boolean {
  const target = targetEpisodeIdentity(metaId);
  if (!target) return false;
  return streamEpisodeMarkers(stream).some((marker) => (
    marker.episode !== target.episode
    || (marker.season !== null && target.season !== null && marker.season !== target.season)
  ));
}

/** Numeric identity dominates; localized episode-title text is only a tiebreaker. */
export function streamEpisodeIdentityConfidence(
  stream: Stream,
  metaId?: string,
  episodeTitle?: string,
): number {
  const target = targetEpisodeIdentity(metaId);
  if (!target) return 0;
  const markers = streamEpisodeMarkers(stream);
  if (markers.some((marker) => (
    marker.episode !== target.episode
    || (marker.season !== null && target.season !== null && marker.season !== target.season)
  ))) {
    return -10_000;
  }
  const full = markers.some((marker) => (
    marker.strength === 'full'
    && marker.episode === target.episode
    && marker.season === target.season
  ));
  const bare = markers.some((marker) => (
    marker.strength === 'bare' && marker.episode === target.episode
  ));
  const titleBonus = streamEpisodeTitleMatches(stream, episodeTitle) ? 10 : -10;
  if (full) return 300 + titleBonus;
  if (bare) return 200 + titleBonus;
  return 50;
}

function streamEpisodeTitleMatches(stream: Stream, expectedTitle?: string): boolean {
  const expected = episodeIdentityTokens(expectedTitle || '');
  if (expected.length === 0) return true;
  const candidates = candidateEpisodeTitleTokens(stream);
  if (candidates.length === 0) return true;
  const expectedPhrase = expected.join(' ');
  return candidates.some((candidate) => candidate.join(' ').includes(expectedPhrase));
}

function targetImdbIdMatchesStream(stream: Stream, metaId?: string): boolean {
  const targetImdbId = metaId?.toLowerCase().match(/tt\d{5,10}/)?.[0];
  if (!targetImdbId) return false;
  const haystack = streamRelevanceHaystack(stream);
  if (new Set(haystack.match(/\btt\d{5,10}\b/g) || []).has(targetImdbId)) return true;
  const digits = targetImdbId.slice(2);
  return new RegExp(`(?:^|[^a-z0-9])${digits}(?:[^a-z0-9]|$)`).test(haystack);
}

/** High-confidence identity contradictions that even a curated title pin cannot bypass. */
export function streamHasExplicitIdentityConflict(
  stream: Stream,
  metaTitle: string,
  metaId?: string,
  context: Pick<
    StreamFilterContext,
    'contentType' | 'metaYear' | 'metaCountry' | 'episodeTitle'
  > = {},
): boolean {
  const haystack = streamRelevanceHaystack(stream);
  const targetImdbId = metaId?.toLowerCase().match(/tt\d{5,10}/)?.[0];
  const releaseImdbIds = new Set(haystack.match(/\btt\d{5,10}\b/g) || []);
  if (targetImdbId && releaseImdbIds.size > 0 && !releaseImdbIds.has(targetImdbId)) {
    return true;
  }
  const targetEdition = metadataEdition(metaTitle, context.metaCountry);
  if (targetEdition) {
    for (const label of streamIdentityLabels(stream)) {
      const releaseLabel = stripReleaseIdentityJunk(label.replace(/[._]/g, ' '));
      if (editionTokensForRelease(releaseLabel, metaTitle).some((edition) => edition !== targetEdition)) {
        return true;
      }
    }
  }
  if (context.metaYear) {
    const releaseYears = explicitReleaseYears(stream);
    if (releaseYears.size > 0 && !releaseYears.has(context.metaYear)) {
      return true;
    }
  }
  return context.contentType === 'series'
    && streamEpisodeIdentityContradicts(stream, metaId);
}

/**
 * Meta title must be the whole release show identity — not a substring of a
 * longer compound title (fix 1+2). Extra content tokens before/after → reject.
 */
export function releaseShowTitleMatchesMeta(
  releaseTitle: string,
  metaTitle: string,
  context: Pick<StreamFilterContext, 'metaCountry'> = {},
): boolean {
  const targetEdition = metadataEdition(metaTitle, context.metaCountry);
  const metaWords = identityWords(metaTitle);
  const titleCarriesEdition = metaWords.length > 1
    ? editionForAlias(metaWords[metaWords.length - 1] || '')
    : null;
  const metaTokens = metaTitleTokensOrdered(metaTitle)
    .filter((token) => !titleCarriesEdition || editionForAlias(token) !== titleCarriesEdition);
  if (metaTokens.length === 0) {
    return true;
  }
  const releaseEditions = editionTokensForRelease(releaseTitle, metaTitle);
  if (targetEdition && releaseEditions.some((edition) => edition !== targetEdition)) {
    return false;
  }
  const releaseTokens = metaTitleTokensOrdered(stripReleaseIdentityJunk(releaseTitle))
    .filter((token) => {
      const edition = editionForAlias(token);
      if (!edition) return true;
      if (titleCarriesEdition === edition) return false;
      return metaWords.includes(token);
    });
  if (releaseTokens.length === 0) {
    return false;
  }
  if (releaseTokens.length !== metaTokens.length) {
    return false;
  }
  return releaseTokens.every((token, index) => token === metaTokens[index]);
}

/** Reject London.Files-style false positives for The Kashmir Files. */
export function streamMatchesMetaTitle(
  stream: Stream,
  metaTitle: string,
  metaId?: string,
  context: Pick<
    StreamFilterContext,
    'contentType' | 'metaYear' | 'metaCountry' | 'episodeTitle'
  > = {},
): boolean {
  const haystack = streamRelevanceHaystack(stream);
  if (streamHasExplicitIdentityConflict(stream, metaTitle, metaId, context)) {
    return false;
  }
  const targetIdMatched = targetImdbIdMatchesStream(stream, metaId);

  const metaTokens = metaTitleTokensOrdered(metaTitle);
  // Empty meta → nothing to enforce. Never bypass for single-token titles (1).
  if (metaTokens.length === 0) {
    return true;
  }

  const releaseTitle = extractReleaseShowTitle(stream);
  if (releaseTitle) {
    if (!releaseShowTitleMatchesMeta(releaseTitle, metaTitle, context)) {
      return false;
    }
  } else if (!targetIdMatched) {
    // No extractable show label: require meta tokens as a contiguous bounded
    // phrase in the haystack (not a loose multi-hit anywhere).
    const phrase = metaTokens.join(' ');
    const bounded = new RegExp(`(?:^|[^a-z0-9])${phrase.replace(/\s+/g, '[^a-z0-9]+')}(?:[^a-z0-9]|$)`);
    if (!bounded.test(haystack)) {
      return false;
    }
    // Single-token: reject when another content token sits immediately before
    // the match (smiling friends / your friends…).
    if (metaTokens.length === 1) {
      const token = metaTokens[0]!;
      const prefixed = new RegExp(`(?:^|[^a-z0-9])[a-z0-9]{2,}[^a-z0-9]+${token}(?:[^a-z0-9]|$)`);
      if (prefixed.test(haystack)) {
        return false;
      }
    }
  }

  // Movies: filename must still carry the primary long token (Kashmir Files case).
  const tokens = metaTitleTokens(metaTitle);
  const primary = tokens[0];
  if (
    context?.contentType === 'movie'
    && primary
    && primary.length >= 5
    && !TITLE_STOP_WORDS.has(primary)
    && !targetIdMatched
  ) {
    const filenameHaystack = streamFilenameHaystack(stream);
    if (!filenameHaystack.trim() || !filenameHaystack.includes(primary)) {
      return false;
    }
  }
  return true;
}

/** Minimum GB per minute of runtime for long features (catches mislabeled tiny encodes). */
const FEATURE_SIZE_GB_PER_MINUTE = 0.004;

export function streamByteSize(stream: Stream): number | null {
  const hints = stream.behaviorHints;
  if (hints && typeof hints === 'object' && !Array.isArray(hints)) {
    const videoSize = (hints as Record<string, unknown>).videoSize;
    if (typeof videoSize === 'number' && Number.isFinite(videoSize) && videoSize > 0) {
      return videoSize;
    }
  }
  if (typeof stream.size_gb === 'number' && Number.isFinite(stream.size_gb) && stream.size_gb > 0) {
    return stream.size_gb * 1_000_000_000;
  }
  return null;
}

export function isSuspiciousFeatureSize(
  stream: Stream,
  runtimeMinutes: number | null | undefined,
  contentType: string | undefined,
): boolean {
  if (contentType !== 'movie') return false;
  if (!runtimeMinutes || runtimeMinutes < 70) return false;
  const bytes = streamByteSize(stream);
  if (!bytes) return false;
  const minBytes = runtimeMinutes * FEATURE_SIZE_GB_PER_MINUTE * 1_000_000_000;
  return bytes < minBytes;
}

export function streamPassesIntegrity(stream: Stream, context: StreamFilterContext): boolean {
  if (!context.metaTitle) {
    return !streamHasExplicitIdentityConflict(stream, '', context.metaId, context);
  }
  if (context.skipTitleFilter) {
    return !streamHasExplicitIdentityConflict(stream, context.metaTitle, context.metaId, context);
  }
  if (!streamMatchesMetaTitle(stream, context.metaTitle, context.metaId, context)) {
    return false;
  }
  if (isSuspiciousFeatureSize(stream, context.metaRuntimeMinutes, context.contentType)) {
    return false;
  }
  return true;
}

export function isSeriesPackForMovie(stream: Stream, contentType: string | undefined): boolean {
  if (contentType !== 'movie') return false;
  const haystack = streamHaystack(stream);
  return /\b(s\d{1,2}e\d{1,2}|\.s\d{1,2}\.|season\s*\d|complete.*\bs\d{1,2}\b|series)\b/i.test(haystack);
}

function parseStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim().toLowerCase());
  return items.length > 0 ? items : fallback;
}

function parseEnvStringList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function streamHaystack(stream: Stream): string {
  return `${stream.title || ''} ${stream.description || ''} ${stream.name || ''}`.toLowerCase();
}

function streamHdrTags(stream: Stream): string[] {
  const enriched = ensureEnrichedStream(stream);
  if (Array.isArray(enriched.hdr_tags)) {
    return enriched.hdr_tags
      .filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '')
      .map((tag) => tag.trim().toLowerCase());
  }
  return [];
}

function streamMatchesPreferredHdr(stream: Stream, preferredTags: string[]): boolean {
  if (preferredTags.length === 0) return false;
  const normalizedPreferred = preferredTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const tags = streamHdrTags(stream);
  if (tags.some((tag) => normalizedPreferred.includes(tag))) {
    return true;
  }
  const haystack = streamHaystack(stream);
  return normalizedPreferred.some((tag) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
  });
}

const HDR_HAYSTACK_RE = /\b(hdr10\+?|hdr|dolby[\s.]?vision|dovi|dv|hlg|pq|st\.?2084|bt\.?2020)\b/i;

/**
 * True when a stream carries HDR (HDR10/HDR10+/Dolby Vision/HLG). Used to keep
 * HDR off the 4K auto-play steps on the X11 stack: X11 cannot output HDR, so a
 * 4K HDR frame must be GPU tone-mapped to SDR every frame, which the Pi 5 cannot
 * sustain at 4K (heavy stutter). SDR 4K plays smoothly; 1080p HDR tone-maps
 * cheaply, so HDR titles fall through to a 1080p step instead.
 */
export function streamIsHdr(stream: Stream): boolean {
  if (streamHdrTags(stream).length > 0) return true;
  return HDR_HAYSTACK_RE.test(streamHaystack(stream));
}

function streamMatchesVideoCodec(stream: Stream, codec: string): boolean {
  const normalized = codec.trim().toLowerCase();
  if (!normalized) return false;
  const enriched = ensureEnrichedStream(stream);
  const haystack = `${streamHaystack(enriched)} ${enriched.encode || ''}`.toLowerCase();
  switch (normalized) {
    case 'hevc':
    case 'h265':
    case 'h.265':
    case 'x265':
      return /\b(hevc|h\.?265|x265)\b/i.test(haystack);
    case 'h264':
    case 'h.264':
    case 'x264':
    case 'avc':
      return /\b(avc|h\.?264|x264)\b/i.test(haystack);
    case 'av1':
      return /\bav1\b/i.test(haystack);
    case 'vp9':
      return /\bvp9\b/i.test(haystack);
    default: {
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
    }
  }
}

function streamMatchesPreferredVideoCodec(stream: Stream, preferredCodecs: string[]): boolean {
  if (preferredCodecs.length === 0) return false;
  return preferredCodecs.some((codec) => streamMatchesVideoCodec(stream, codec));
}

/**
 * True when a stream is HEVC/H.265/x265 — the only codec the Pi 5 (BCM2712)
 * decodes in hardware. Used as a hard guard so 4K auto-play never lands on a
 * software-decoded (H.264/AV1/VP9) stream that would stutter.
 */
export function streamIsHevc(stream: Stream): boolean {
  return streamMatchesVideoCodec(stream, 'hevc');
}

/**
 * Hardware decode profile — the single source of truth for which streams this
 * box can decode *smoothly*. Pi 5 (BCM2712) has one hardware video decoder
 * (HEVC) and soft-decodes everything else; the CPU sustains soft decode only up
 * to ~1080p (4K H.264/AV1/VP9 stutters). Override per box:
 *   MANGO_HW_DECODE_CODECS      (default "hevc")   — codecs the SoC decodes in HW at any resolution
 *   MANGO_HW_SOFT_MAX_QUALITY   (default "1080p")  — highest resolution a non-HW codec still plays smoothly
 */
function hardwareDecodeCodecs(): string[] {
  const raw = parseEnvStringList(process.env.MANGO_HW_DECODE_CODECS);
  return raw.length > 0 ? raw : ['hevc'];
}

function hardwareSoftMaxRank(): number {
  const parsed = parseQualityCap(process.env.MANGO_HW_SOFT_MAX_QUALITY);
  return parsed ? QUALITY_ORDER[parsed] : QUALITY_ORDER['1080p'];
}

/**
 * True when the box can decode this stream at a smooth framerate: a hardware
 * codec (HEVC) at any resolution, OR any codec at/below the soft-decode ceiling
 * (1080p). Non-HW codecs above the ceiling (4K AV1/H.264/VP9) return false.
 * Unknown-resolution streams are treated as smooth (typically ≤1080p web) so we
 * never demote a stream we cannot prove is a heavy 4K soft-decode. This ranks
 * (never excludes) — a lone unsupported stream still plays.
 */
export function streamHardwareDecodeSmooth(stream: Stream): boolean {
  const enriched = ensureEnrichedStream(stream);
  if (hardwareDecodeCodecs().some((codec) => streamMatchesVideoCodec(enriched, codec))) {
    return true;
  }
  const rank = effectiveStreamQualityRank(enriched);
  if (rank === null) return true;
  return rank <= hardwareSoftMaxRank();
}

function languageHaystack(stream: Stream): string {
  const raw = `${stream.title || ''}\n${stream.description || ''}\n${stream.name || ''}`;
  return textWithoutSubtitleLines(raw).toLowerCase();
}

function ensureEnrichedStream(stream: Stream): Stream {
  if (typeof stream.display_label === 'string' && stream.display_label.trim() !== '') {
    return stream;
  }
  return enrichStreamMetadata(stream);
}

function bingeGroup(stream: Stream): string | undefined {
  const hints = stream.behaviorHints;
  if (typeof hints !== 'object' || hints === null) return undefined;
  const group = (hints as { bingeGroup?: unknown }).bingeGroup;
  return typeof group === 'string' ? group : undefined;
}

function sourceDebridService(source: string | undefined): string | null {
  const normalized = (source || '').toLowerCase();
  if (normalized.includes('torrentio rd') || normalized.includes('realdebrid') || normalized.includes('real-debrid')) {
    return 'realdebrid';
  }
  if (normalized.includes('torrentio tb') || normalized.includes('torbox')) {
    return 'torbox';
  }
  return null;
}

export function debridServiceId(stream: Stream): string | null {
  const fromSource = sourceDebridService(stream.source);
  if (fromSource) return fromSource;

  const group = bingeGroup(stream);
  if (group) {
    const parts = group.split('|');
    if (parts.length >= 2) {
      const service = parts[1]?.toLowerCase();
      if (service && DEBRID_SERVICE_IDS.has(service)) return service;
    }
  }

  const haystack = streamHaystack(stream);
  if (/\breal[- ]?debrid\b|\brd\b/.test(haystack)) return 'realdebrid';
  if (/\btorbox\b|\btb\b/.test(haystack)) return 'torbox';
  if (/\bpremiumize\b/.test(haystack)) return 'premiumize';
  if (/\bdebrid\b/.test(haystack)) return 'debrid';

  try {
    const host = new URL(stream.url).hostname.toLowerCase();
    if (host.includes('real-debrid') || host.includes('realdebrid')) return 'realdebrid';
    if (host.includes('torbox')) return 'torbox';
    if (host.includes('debrid')) return 'debrid';
  } catch {
    // ignore invalid URLs
  }

  return null;
}

export function isDebridStream(stream: Stream): boolean {
  return debridServiceId(stream) !== null;
}

function parseAioStreamsBingeGroupCacheStatus(stream: Stream): 'cached' | 'uncached' | null {
  const group = bingeGroup(stream);
  if (!group) return null;
  const addonId = group?.split('|')[0]?.toLowerCase();
  if (addonId !== 'com.aiostreams' && addonId !== 'aiostreams') return null;

  const parts = group.split('|');
  if (parts.length < 3) return null;

  const service = parts[1]?.toLowerCase();
  if (!service || !DEBRID_SERVICE_IDS.has(service)) return null;

  const flag = parts[2]?.toLowerCase();
  if (flag === 'true') return 'cached';
  if (flag === 'false') return 'uncached';
  return null;
}

/**
 * AIOStreams formatter cache tags when explicit cache metadata is absent.
 *
 * The configured `lightgdrive` formatter emits `[TB⚡]` / `[TB⏳]` (and the
 * equivalent RD badges). The built-in Torrentio formatter uses `[RD+]` /
 * `[RD download]`. Keep both shapes because changing formatter presets must not
 * silently turn a known uncached stream into `unknown`.
 */
function parseAioStreamsNameCacheStatus(stream: Stream): 'cached' | 'uncached' | null {
  const label = `${stream.name || ''} ${stream.title || ''}`;
  if (!/\[(?:TB|RD)/i.test(label)) return null;
  if (/⏳|\bdownload\]/i.test(label)) return 'uncached';
  if (/☁️|✔|⚡|\+(?:\]|\s)/.test(label)) return 'cached';
  return null;
}

/** Legacy AIOStreams bingeGroup metadata, then current formatter text. */
export function parseDebridCacheStatus(stream: Stream): 'cached' | 'uncached' | 'unknown' {
  const fromGroup = parseAioStreamsBingeGroupCacheStatus(stream);
  if (fromGroup) return fromGroup;

  const haystack = streamHaystack(stream);
  if (/\bnot cached\b|\buncached\b/.test(haystack)) return 'uncached';
  if (/\bcached\b/.test(haystack) && !/\bnot cached\b|\buncached\b/.test(haystack)) return 'cached';

  const fromName = parseAioStreamsNameCacheStatus(stream);
  if (fromName) return fromName;

  return 'unknown';
}

/** Defense in depth for the locked policy: RD uncached never reaches couch play. */
export function isExcludedUncachedRealDebrid(stream: Stream): boolean {
  return debridServiceId(stream) === 'realdebrid'
    && parseDebridCacheStatus(stream) === 'uncached';
}

export function streamQuality(stream: Stream): QualityCap | null {
  if (typeof stream.resolution === 'string') {
    const parsed = parseQualityCap(stream.resolution);
    if (parsed) return parsed;
  }
  if (stream.quality) {
    const parsed = parseQualityCap(stream.quality);
    if (parsed) return parsed;
  }
  const match = streamHaystack(stream).match(/\b(2160p|4k|1440p|1080p|720p|480p)\b/i);
  return match ? parseQualityCap(match[1]) : null;
}

export function effectiveStreamQualityRank(stream: Stream): number | null {
  if (/\b1440p\b/i.test(streamHaystack(stream))) return 1440;
  const quality = streamQuality(stream);
  return quality ? QUALITY_ORDER[quality] : null;
}

function uniqueLanguages(...languageSets: Array<unknown>): string[] {
  const languages: string[] = [];
  for (const set of languageSets) {
    if (!Array.isArray(set)) continue;
    for (const item of set) {
      if (typeof item !== 'string' || item.trim() === '') continue;
      const value = item.trim();
      if (!languages.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
        languages.push(value);
      }
    }
  }
  return languages;
}

/** Parse AIOStreams lightgdrive rows into structured fields for picker + AI. */
export function enrichStreamMetadata(stream: Stream): Stream {
  const haystack = streamHaystack(stream);
  let resolution = streamQuality(stream);
  if (!resolution && /\b1440p\b/i.test(haystack)) resolution = '1080p'; // rank handled by effectiveQualityRank
  const resolutionLabel = /\b1440p\b/i.test(haystack) ? '1440p' : resolution ?? undefined;
  const releaseMatch = haystack.match(/\b(bluray|blu[\s-]?ray|web[\s-]?dl|webrip|hdtv|remux|bdrip)\b/i);
  const legacyLanguages: string[] = [];
  const languageSource = textWithoutSubtitleLines(haystack);
  if (/\b(hindi|हिंदी)\b/i.test(languageSource)) legacyLanguages.push('Hindi');
  if (/\b(english|eng)\b/i.test(languageSource)) legacyLanguages.push('English');
  if (/\b(tamil|telugu|malayalam|kannada|bengali|punjabi|marathi)\b/i.test(languageSource)) {
    const regional = languageSource.match(/\b(tamil|telugu|malayalam|kannada|bengali|punjabi|marathi)\b/i)?.[1];
    if (regional) legacyLanguages.push(regional[0].toUpperCase() + regional.slice(1).toLowerCase());
  }
  const formatterFields = parseFormatterDescription([
    typeof stream.description === 'string' ? stream.description : '',
    typeof stream.title === 'string' ? stream.title : '',
    typeof stream.name === 'string' ? stream.name : '',
    typeof stream.quality === 'string' ? stream.quality : '',
  ].filter(Boolean).join('\n'));
  const languages = uniqueLanguages(formatterFields.languages, stream.languages, legacyLanguages);
  const debrid = debridServiceId(stream);
  const cache = parseDebridCacheStatus(stream);
  const enriched = {
    ...stream,
    resolution: formatterFields.resolution ?? resolutionLabel,
    release_tier: formatterFields.release_tier ?? releaseMatch?.[1]?.replace(/\s+/g, '') ?? undefined,
    release_group: formatterFields.release_group ?? stream.release_group,
    encode: formatterFields.encode ?? stream.encode,
    size_gb: formatterFields.size_gb ?? stream.size_gb,
    indexer: formatterFields.indexer ?? stream.indexer,
    hdr_tags: formatterFields.hdr_tags && formatterFields.hdr_tags.length > 0
      ? formatterFields.hdr_tags
      : stream.hdr_tags,
    languages: languages.length > 0 ? languages : undefined,
    debrid_service: debrid ?? undefined,
    cache_status: cache,
  };
  return {
    ...enriched,
    display_label: buildDisplayLabel(formatterFields, enriched),
  };
}

function streamLanguages(stream: Stream): string[] {
  if (Array.isArray(stream.languages)) {
    return stream.languages.filter((item): item is string => typeof item === 'string');
  }
  const enriched = enrichStreamMetadata(stream);
  return Array.isArray(enriched.languages) ? enriched.languages : [];
}

export function streamMatchesLanguage(stream: Stream, language: string): boolean {
  const needle = language.trim().toLowerCase();
  if (!needle) return true;
  const languages = streamLanguages(stream);
  if (languages.length > 0) {
    return languages.some((item) => item.toLowerCase().includes(needle));
  }
  return languageHaystack(stream).includes(needle);
}

export function isRemux(stream: Stream): boolean {
  return /\bremux\b|\bblu[- ]?ray\b.*\bremux\b/i.test(streamHaystack(stream));
}

export function isErrorStream(stream: Stream): boolean {
  const haystack = streamHaystack(stream);
  const url = typeof stream.url === 'string' ? stream.url : '';
  if (url && (/example\.com\/ratelimit|ratelimit/i.test(url))) {
    return true;
  }
  return /\[❌\]|\[x\]|search failed|not found|no streams|error:|stream not found|being downloaded|downloading to debrid|download pending|rate\s*limit exceeded/i.test(haystack);
}

/** True when a raw addon stream is worth caching (not a rate-limit / error placeholder). */
export function isCacheableStream(stream: Stream): boolean {
  if (isErrorStream(stream)) return false;
  const url = typeof stream.url === 'string' ? stream.url : '';
  if (url && isRateLimitedStreamUrl(url)) return false;
  return Boolean(url);
}

export function hasCacheableStream(streams: Stream[]): boolean {
  return streams.some(isCacheableStream);
}

/** Cam / telesync / screener — poor couch experience; skip uncached fallback. */
export function isLowQualityRelease(stream: Stream): boolean {
  const haystack = streamHaystack(stream);
  return /\b(hdcam|hd[\s-]?cam|camrip|cam[\s-]?rip|telesync|dvdscr|dvd[\s-]?scr|workprint)\b/i.test(haystack)
    || /\b(ts|scr|tc)\b/i.test(haystack);
}

/** Bonus discs, BTS, featurettes — wrong file for movie play (series keeps indexer labels like "Bonus E01"). */
export function isSupplementalRelease(stream: Stream, contentType?: string): boolean {
  if (contentType?.trim().toLowerCase() === 'series') {
    return false;
  }
  const haystack = streamHaystack(stream);
  return /\b(behind[\s-]?the[\s-]?scenes|featurette|bonus|extras?|making[\s-]?of|interview|deleted[\s-]?scene|bts|after[\s-]?credits|promo[\s-]?reel|proof[\s-]?reel|sample[\s-]?clip|sneak[\s-]?peek|production[\s-]?diary)\b/i.test(haystack);
}

export function parseRuntimeMinutes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const hours = trimmed.match(/(\d+)\s*h/);
  const minutes = trimmed.match(/(\d+)\s*m/);
  let total = 0;
  if (hours) {
    total += Number(hours[1]) * 60;
  }
  if (minutes) {
    total += Number(minutes[1]);
  }
  if (total > 0) {
    return total;
  }
  const bare = trimmed.match(/^(\d+)$/);
  return bare ? Number(bare[1]) : null;
}

export function isPlausibleFeatureDuration(
  probedMinutes: number,
  contentType: string | undefined,
  expectedMinutes?: number | null,
  options: { episodeRole?: 'main' | 'bonus' } = {},
): boolean {
  if (!Number.isFinite(probedMinutes) || probedMinutes <= 0) {
    return false;
  }
  // Bonus / deleted-moments clips are often 1–8 minutes — never treat as status clips.
  if (options.episodeRole === 'bonus') {
    return probedMinutes >= 0.5;
  }
  if (contentType === 'series') {
    return probedMinutes >= 10;
  }
  if (probedMinutes < 40) {
    return false;
  }
  if (expectedMinutes && expectedMinutes >= 70) {
    return probedMinutes >= expectedMinutes * 0.45;
  }
  return true;
}

/** Couch play min duration (seconds) passed to mpv-play.sh. */
export function playMinDurationSec(options: {
  contentType?: string;
  episodeRole?: 'main' | 'bonus';
}): number {
  if (options.episodeRole === 'bonus') {
    const raw = Number(process.env.MANGO_PLAY_BONUS_MIN_DURATION_SEC || 30);
    return Number.isFinite(raw) ? Math.max(5, Math.min(600, Math.floor(raw))) : 30;
  }
  if (options.contentType === 'series') {
    // Main episodes: 2 min floor (status clips); full eps are >> this.
    const raw = Number(process.env.MANGO_PLAY_SERIES_MIN_DURATION_SEC || 120);
    return Number.isFinite(raw) ? Math.max(30, Math.min(600, Math.floor(raw))) : 120;
  }
  // Movies: keep 10 min to reject trailers / status clips.
  const raw = Number(process.env.MANGO_PLAY_MOVIE_MIN_DURATION_SEC || 600);
  return Number.isFinite(raw) ? Math.max(60, Math.min(3600, Math.floor(raw))) : 600;
}

/** Unknown-cache RD BluRay/x265 — last-resort auto-play only. */
export function isRdSafeUnknownRelease(stream: Stream): boolean {
  if (debridServiceId(stream) !== 'realdebrid') return false;
  if (parseDebridCacheStatus(stream) !== 'unknown') return false;
  if (isLowQualityRelease(stream)) return false;
  const haystack = streamHaystack(stream);
  if (/\b(webrip|web-dl|webdl|amzn)\b/i.test(haystack)) return false;
  return /\b(bluray|blu[\s-]?ray|bdrip|bd[\s-]?rip|x265|hevc|10bit|aac)\b/i.test(haystack);
}

/**
 * Higher = try sooner. AIOStreams owns debrid/release ranking; mango scores probe fit.
 */
export function streamPlayScore(
  stream: Stream,
  config: StreamPlayScoreConfig,
  verifiedHint?: VerifiedStreamHint,
  options: { preferred_language?: string | null } = {},
): number {
  let score = 0;
  const cache = streamCacheStatus(stream);
  if (cache === 'cached') score += 1000;
  else if (cache === 'unknown') score += 500;
  else if (cache === 'uncached') score += 200;

  const quality = streamQuality(stream);
  if (quality === '1080p') score += 30;
  else if (quality === '2160p') score += config.preferred_quality === '2160p' ? 35 : 10;
  else if (quality === '720p') score += 15;
  else if (quality === '480p') score += 5;

  if (config.max_quality && quality) {
    score -= qualityRank(stream, config.max_quality);
  }

  if (streamMatchesPreferredHdr(stream, config.preferred_hdr_tags)) {
    score += 160;
  }

  if (streamMatchesPreferredVideoCodec(stream, config.preferred_video_codecs)) {
    score += quality === '2160p' ? 180 : 80;
  }

  // Hardware-decode smoothness tiebreaker. Ranks the HW-decodable option first
  // *within* a resolution (e.g. 4K HEVC over 4K AV1) so smooth 4K wins whenever
  // it exists — without excluding the soft-decode stream. Cross-resolution order
  // ("always prefer 4K") is owned by the play ladder step order, not this score.
  if (streamHardwareDecodeSmooth(stream)) {
    score += quality === '2160p' ? 90 : 40;
  }

  if (options.preferred_language && streamMatchesLanguage(stream, options.preferred_language)) {
    score += 200;
  }

  if (verifiedHint) {
    if (streamMatchesVerifiedHint(stream, verifiedHint)) score += 5000;
    const source = normalizeAddonName(stream.source || '');
    const hintSource = normalizeAddonName(verifiedHint.best_source || '');
    if (hintSource && source.includes(hintSource)) score += 800;
    if (verifiedHint.cache_status && streamCacheStatus(stream) === verifiedHint.cache_status) {
      score += 400;
    }
    if (verifiedHint.debrid_service && debridServiceId(stream) === verifiedHint.debrid_service) {
      score += 200;
    }
  }

  return score;
}

export function streamUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

export function streamMatchesVerifiedHint(stream: Stream, verifiedHint?: VerifiedStreamHint): boolean {
  if (!verifiedHint?.win_url_hash) return false;
  return streamStableIdentity(stream) === verifiedHint.win_url_hash
    || streamUrlHash(stream.url) === verifiedHint.win_url_hash;
}

/** Stable release identity scoped to a service; signed URL is fallback only. */
export function streamStableIdentity(stream: Stream): string {
  const service = debridServiceId(stream) ?? 'direct';
  const hints = stream.behaviorHints && typeof stream.behaviorHints === 'object'
    ? stream.behaviorHints as Record<string, unknown>
    : {};
  const infoHash = typeof hints.infoHash === 'string' ? hints.infoHash.trim().toLowerCase() : '';
  if (infoHash) return `svc:${service}|ih:${infoHash}`;
  const binge = typeof hints.bingeGroup === 'string' ? hints.bingeGroup.trim() : '';
  const releaseToken = binge.split('|').slice(4).find((token) => {
    const normalized = token.trim();
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64}|[a-z2-7]{32})$/i.test(normalized)
      || /^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(normalized);
  });
  if (releaseToken) return `svc:${service}|bg:${releaseToken.trim().toLowerCase()}`;
  return `svc:${service}|url:${streamUrlHash(stream.url)}`;
}

function qualityBelowMin(stream: Stream, min: QualityCap | null | undefined): boolean {
  if (!min) return false;
  const rank = effectiveStreamQualityRank(stream);
  if (rank === null) return false;
  return rank < QUALITY_ORDER[min];
}

function qualityExceedsCap(stream: Stream, cap: QualityCap | null): boolean {
  if (!cap) return false;
  const rank = effectiveStreamQualityRank(stream);
  if (rank === null) return false;
  return rank > QUALITY_ORDER[cap];
}

export function defaultFilterConfig(): StreamFilterConfig {
  const envStrictUnknown = process.env.MANGO_STRICT_UNKNOWN_CACHE;
  return {
    exclude_uncached_debrid: !truthy(process.env.MANGO_INCLUDE_UNCACHED),
    strict_unknown_cache: envStrictUnknown === undefined ? true : !falsy(envStrictUnknown),
    max_quality: parseQualityCap(process.env.MANGO_MAX_QUALITY) ?? '1080p',
    exclude_remux: process.env.MANGO_EXCLUDE_REMUX === undefined
      ? true
      : truthy(process.env.MANGO_EXCLUDE_REMUX),
    auto_play_max_attempts: positiveInteger(process.env.MANGO_AUTO_PLAY_MAX_ATTEMPTS, 12, 1, 20),
    auto_play_wall_ms: positiveInteger(process.env.MANGO_AUTO_PLAY_WALL_MS, 90000, 1000, 120000),
    auto_play_probe_ms: positiveInteger(process.env.MANGO_AUTO_PLAY_PROBE_MS, 8000, 500, 20000),
    auto_play_uncached_probe_ms: positiveInteger(process.env.MANGO_AUTO_PLAY_UNCACHED_PROBE_MS, 25000, 5000, 45000),
    preferred_quality: parseQualityCap(process.env.MANGO_PREFERRED_QUALITY) ?? '1080p',
    preferred_hdr_tags: parseEnvStringList(process.env.MANGO_PREFERRED_HDR_TAGS),
    preferred_video_codecs: parseEnvStringList(process.env.MANGO_PREFERRED_VIDEO_CODECS),
    play_ladder: defaultPlayLadder(),
    main_ladder: splitLegacyPlayLadder(defaultPlayLadder()).main_ladder,
    last_resort_ladder: splitLegacyPlayLadder(defaultPlayLadder()).last_resort_ladder,
    exclude_error_streams: true,
    stream_display_limit: positiveInteger(process.env.MANGO_STREAM_DISPLAY_LIMIT, 8, 3, 20),
  };
}

export async function loadFilterConfig(
  path = process.env.MANGO_CATALOG_FILTERS || DEFAULT_FILTERS_PATH,
): Promise<StreamFilterConfig> {
  const base = defaultFilterConfig();
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<StreamFilterConfig> & {
      include_uncached?: boolean;
    };
    if (typeof raw.exclude_uncached_debrid === 'boolean') {
      base.exclude_uncached_debrid = raw.exclude_uncached_debrid;
    }
    if (typeof raw.strict_unknown_cache === 'boolean') {
      base.strict_unknown_cache = raw.strict_unknown_cache;
    }
    if (raw.max_quality !== undefined) {
      base.max_quality = parseQualityCap(raw.max_quality);
    }
    if (typeof raw.exclude_remux === 'boolean') {
      base.exclude_remux = raw.exclude_remux;
    }
    if (raw.auto_play_max_attempts !== undefined) {
      base.auto_play_max_attempts = positiveInteger(raw.auto_play_max_attempts, base.auto_play_max_attempts, 1, 20);
    }
    if (raw.auto_play_wall_ms !== undefined) {
      base.auto_play_wall_ms = positiveInteger(raw.auto_play_wall_ms, base.auto_play_wall_ms, 1000, 120000);
    }
    if (raw.auto_play_probe_ms !== undefined) {
      base.auto_play_probe_ms = positiveInteger(raw.auto_play_probe_ms, base.auto_play_probe_ms, 500, 20000);
    }
    if (raw.auto_play_uncached_probe_ms !== undefined) {
      base.auto_play_uncached_probe_ms = positiveInteger(
        raw.auto_play_uncached_probe_ms,
        base.auto_play_uncached_probe_ms,
        5000,
        45000,
      );
    }
    if (raw.preferred_quality !== undefined) {
      base.preferred_quality = parseQualityCap(raw.preferred_quality) ?? base.preferred_quality;
    }
    if (raw.preferred_hdr_tags !== undefined) {
      base.preferred_hdr_tags = parseStringList(raw.preferred_hdr_tags, base.preferred_hdr_tags);
    }
    if (raw.preferred_video_codecs !== undefined) {
      base.preferred_video_codecs = parseStringList(raw.preferred_video_codecs, base.preferred_video_codecs);
    }
    const rawRecord = raw as Record<string, unknown>;
    if (rawRecord.main_ladder !== undefined || rawRecord.last_resort_ladder !== undefined) {
      const main = rawRecord.main_ladder !== undefined
        ? parsePlayLadder(rawRecord.main_ladder)
        : undefined;
      const lastResort = rawRecord.last_resort_ladder !== undefined
        ? parsePlayLadder(rawRecord.last_resort_ladder)
        : undefined;
      if (main) base.main_ladder = main;
      if (lastResort) base.last_resort_ladder = lastResort;
      if (!main || !lastResort) {
        const split = splitLegacyPlayLadder(
          raw.play_ladder !== undefined ? parsePlayLadder(raw.play_ladder) : base.play_ladder,
        );
        if (!main) base.main_ladder = split.main_ladder;
        if (!lastResort) base.last_resort_ladder = split.last_resort_ladder;
      }
      base.play_ladder = combinePlayLadders(base.main_ladder, base.last_resort_ladder);
    } else if (raw.play_ladder !== undefined) {
      base.play_ladder = parsePlayLadder(raw.play_ladder);
      const split = splitLegacyPlayLadder(base.play_ladder);
      base.main_ladder = split.main_ladder;
      base.last_resort_ladder = split.last_resort_ladder;
    }
    // Legacy pre-ladder keys may still exist on Pi live configs — ignored
    // intentionally (this loader is field-by-field, not strict-schema).
    if (typeof raw.exclude_error_streams === 'boolean') {
      base.exclude_error_streams = raw.exclude_error_streams;
    }
    if (raw.stream_display_limit !== undefined) {
      base.stream_display_limit = positiveInteger(raw.stream_display_limit, base.stream_display_limit, 3, 20);
    }
    if (raw.include_uncached === true) {
      base.exclude_uncached_debrid = false;
    }
  } catch {
    // optional file — env defaults apply
  }
  validateMainLadderPiPolicy(base.main_ladder);
  return base;
}

/** Every verified/main step admitting 4K must require Pi 5 hardware-decodable HEVC. */
export function validateMainLadderPiPolicy(mainLadder: PlayLadderStep[]): void {
  const unsafe = mainLadder.find((step) => (
    (step.max_quality === null || step.max_quality === '2160p')
    && step.require_hevc !== true
  ));
  if (unsafe) {
    throw new Error(`unsafe main ladder step ${unsafe.step}: 4K requires require_hevc=true`);
  }
}

export function mergeFilterConfig(
  base: StreamFilterConfig,
  overrides: StreamFilterOverrides = {},
): StreamFilterConfig & {
  include_uncached: boolean;
  hard_language?: string | null;
  preferred_language?: string | null;
  min_quality?: QualityCap | null;
  request_overrides: StreamFilterOverrides;
} {
  const includeUncached = overrides.include_uncached === true;
  return {
    exclude_uncached_debrid: includeUncached ? false : base.exclude_uncached_debrid,
    strict_unknown_cache: overrides.strict_unknown_cache ?? base.strict_unknown_cache,
    max_quality: overrides.max_quality !== undefined ? overrides.max_quality : base.max_quality,
    exclude_remux: overrides.exclude_remux ?? base.exclude_remux,
    auto_play_max_attempts: base.auto_play_max_attempts,
    auto_play_wall_ms: base.auto_play_wall_ms,
    auto_play_probe_ms: base.auto_play_probe_ms,
    auto_play_uncached_probe_ms: base.auto_play_uncached_probe_ms,
    preferred_quality: base.preferred_quality,
    preferred_hdr_tags: base.preferred_hdr_tags,
    preferred_video_codecs: base.preferred_video_codecs,
    play_ladder: base.play_ladder,
    main_ladder: base.main_ladder,
    last_resort_ladder: base.last_resort_ladder,
    exclude_error_streams: base.exclude_error_streams,
    stream_display_limit: base.stream_display_limit,
    include_uncached: includeUncached,
    hard_language: overrides.hard_language,
    preferred_language: overrides.preferred_language,
    min_quality: overrides.min_quality,
    request_overrides: { ...overrides },
  };
}

export function parseFilterOverridesFromQuery(
  params: URLSearchParams,
): StreamFilterOverrides {
  const overrides: StreamFilterOverrides = {};
  if (params.has('include_uncached')) {
    overrides.include_uncached = truthy(params.get('include_uncached') || undefined);
  }
  if (params.has('strict_unknown_cache')) {
    overrides.strict_unknown_cache = truthy(params.get('strict_unknown_cache') || undefined);
  }
  if (params.has('max_quality')) {
    overrides.max_quality = parseQualityCap(params.get('max_quality'));
  }
  if (params.has('exclude_remux')) {
    overrides.exclude_remux = truthy(params.get('exclude_remux') || undefined);
  }
  if (params.has('min_quality')) {
    overrides.min_quality = parseQualityCap(params.get('min_quality'));
  }
  if (params.has('language')) {
    const language = params.get('language');
    overrides.hard_language = language && language.trim() !== '' ? language.trim() : null;
  }
  if (params.has('preferred_language')) {
    const language = params.get('preferred_language');
    overrides.preferred_language = language && language.trim() !== '' ? language.trim() : null;
  }
  return overrides;
}

function qualityRank(stream: Stream, cap: QualityCap | null): number {
  const quality = streamQuality(stream);
  if (!quality) return 999;
  if (cap && QUALITY_ORDER[quality] > QUALITY_ORDER[cap]) return 1000;
  const target = cap ? QUALITY_ORDER[cap] : QUALITY_ORDER['1080p'];
  return Math.abs(QUALITY_ORDER[quality] - target);
}

export function filterAndRankStreams(
  streams: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
  context: StreamFilterContext = {},
  options: {
    hard_language?: string | null;
    preferred_language?: string | null;
    min_quality?: QualityCap | null;
  } = {},
): { streams: Stream[]; meta: StreamFilterMeta } {
  const meta: StreamFilterMeta = {
    applied: config,
    total: streams.length,
    kept: 0,
    excluded: {
      uncached_debrid: 0,
      unknown_cache_debrid: 0,
      above_max_quality: 0,
      remux: 0,
      error_stream: 0,
      title_mismatch: 0,
      series_pack_for_movie: 0,
      language_mismatch: 0,
    },
  };

  const kept: Stream[] = [];
  for (const raw of streams) {
    const stream = ensureEnrichedStream(raw);
    const debrid = isDebridStream(stream);
    const cacheStatus = parseDebridCacheStatus(stream);

    if (!streamPassesIntegrity(stream, context)) {
      meta.excluded.title_mismatch += 1;
      continue;
    }
    if (isSeriesPackForMovie(stream, context.contentType)) {
      meta.excluded.series_pack_for_movie += 1;
      continue;
    }
    if (isSupplementalRelease(stream, context.contentType)) {
      meta.excluded.error_stream += 1;
      continue;
    }
    if (config.exclude_error_streams && isErrorStream(stream)) {
      meta.excluded.error_stream += 1;
      continue;
    }
    if (options.hard_language && !streamMatchesLanguage(stream, options.hard_language)) {
      meta.excluded.language_mismatch += 1;
      continue;
    }
    if (options.min_quality && qualityBelowMin(stream, options.min_quality)) {
      meta.excluded.above_max_quality += 1;
      continue;
    }
    if (config.exclude_remux && isRemux(stream)) {
      meta.excluded.remux += 1;
      continue;
    }
    if (qualityExceedsCap(stream, config.max_quality)) {
      meta.excluded.above_max_quality += 1;
      continue;
    }
    if (debrid) {
      if (isExcludedUncachedRealDebrid(stream)
        || (config.exclude_uncached_debrid && cacheStatus === 'uncached')) {
        meta.excluded.uncached_debrid += 1;
        continue;
      }
      if (config.exclude_uncached_debrid
        && cacheStatus === 'unknown'
        && config.strict_unknown_cache) {
        meta.excluded.unknown_cache_debrid += 1;
        continue;
      }
    }

    kept.push({
      ...stream,
      debrid_service: debridServiceId(stream) ?? undefined,
      cache_status: cacheStatus,
    });
  }

  rankKeptStreams(kept, config, options);

  meta.kept = kept.length;
  const limited = kept.slice(0, config.stream_display_limit);
  return { streams: limited, meta: { ...meta, kept: limited.length } };
}

function rankKeptStreams(
  kept: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
  options: { preferred_language?: string | null } = {},
): void {
  kept.sort((left, right) => streamPlayScore(right, config, undefined, options)
    - streamPlayScore(left, config, undefined, options));
}

function normalizeAddonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\|\s*/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sourceMatches(stream: Stream, addons: string[]): boolean {
  const source = normalizeAddonName(stream.source || '');
  return addons.some((addon) => {
    const normalized = normalizeAddonName(addon);
    return normalized !== '' && (source === normalized || source.includes(normalized));
  });
}

function streamCacheStatus(stream: Stream): ReturnType<typeof parseDebridCacheStatus> {
  const explicit = stream.cache_status;
  if (explicit === 'cached' || explicit === 'uncached' || explicit === 'unknown') {
    return explicit;
  }
  return parseDebridCacheStatus(stream);
}

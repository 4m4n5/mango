import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Stream } from './core.js';

export type VerifiedStreamHint = {
  best_source?: string | null;
  cache_status?: string | null;
  debrid_service?: string | null;
  win_url_hash?: string | null;
};

export type QualityCap = '480p' | '720p' | '1080p' | '2160p';
export type AutoPlayCacheRequirement = 'cached' | 'cached_or_unknown' | 'any';

export type AutoPlayTier = {
  addons: string[];
  require_cache: AutoPlayCacheRequirement;
  /** When set, only streams from these debrid hosts (e.g. torbox before realdebrid). */
  debrid_services?: string[];
};

export type StreamFilterConfig = {
  /** Drop debrid streams that look uncached (default on). */
  exclude_uncached_debrid: boolean;
  /** Also drop debrid streams when cache status is unknown (stricter). */
  strict_unknown_cache: boolean;
  /** Drop streams above this resolution (helps Pi until N7). */
  max_quality: QualityCap | null;
  /** Drop REMUX / Blu-ray remux style releases. */
  exclude_remux: boolean;
  /** Prefer earlier services when ranking and supplementing auto-play candidates. */
  debrid_preference: string[];
  /** Drop Real-Debrid streams whose title/name matches these tags (RD keyword filter). */
  exclude_rd_release_tags: string[];
  /** Drop addon error placeholder streams (e.g. AIOStreams `[❌] TorBox Search`). */
  exclude_error_streams: boolean;
  /** When no cached streams remain, allow uncached TorBox (not Real-Debrid). */
  uncached_torbox_fallback: boolean;
  /** When TorBox fallback is empty, allow unknown-cache RD BluRay/x265 (not WEBRip). */
  rd_safe_unknown_fallback: boolean;
  /** Max candidate URLs to try during automatic Play. */
  auto_play_max_attempts: number;
  /** Hard wall-clock budget for automatic Play. */
  auto_play_wall_ms: number;
  /** Per-URL mpv probe budget. */
  auto_play_probe_ms: number;
  /** Ordered automatic Play tiers. */
  auto_play_tiers: AutoPlayTier[];
};

export type StreamFilterOverrides = {
  include_uncached?: boolean;
  strict_unknown_cache?: boolean;
  max_quality?: QualityCap | null;
  exclude_remux?: boolean;
};

export type StreamFilterMeta = {
  applied: StreamFilterConfig & { include_uncached: boolean };
  total: number;
  kept: number;
  /** Set when strict filters returned 0 streams and uncached TorBox picks were used. */
  torbox_uncached_fallback?: boolean;
  /** Set when RD unknown-cache BluRay/x265 picks were used as last resort. */
  rd_safe_unknown_fallback?: boolean;
  /** Set when strict title tokens matched nothing but imdb-id / relaxed pass recovered streams. */
  title_filter_relaxed?: boolean;
  excluded: {
    uncached_debrid: number;
    unknown_cache_debrid: number;
    above_max_quality: number;
    remux: number;
    error_stream: number;
    rd_blocked_release: number;
    title_mismatch: number;
    series_pack_for_movie: number;
  };
};

export type StreamFilterContext = {
  metaTitle?: string;
  /** Stremio/Cinemeta id (e.g. tt0111161) for torrent name matching. */
  metaId?: string;
  contentType?: string;
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

const DEFAULT_DEBRID_PREFERENCE = ['torbox', 'realdebrid'];
const DEFAULT_RD_BLOCKED_TAGS = ['webrip', 'web-dl', 'webdl', 'amzn'];
const TITLE_STOP_WORDS = new Set([
  'the', 'and', 'of', 'a', 'an', 'in', 'on', 'to', 'for', 'part',
  'files', 'file', 'story', 'love', 'home', 'night', 'dead', 'last',
  'kill', 'show', 'game', 'world', 'life', 'moon', 'star', 'man', 'men',
]);

function metaTitleTokens(metaTitle: string): string[] {
  return metaTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !TITLE_STOP_WORDS.has(token))
    .sort((left, right) => right.length - left.length);
}

/** Reject London.Files-style false positives for The Kashmir Files. */
export function streamMatchesMetaTitle(
  stream: Stream,
  metaTitle: string,
  metaId?: string,
): boolean {
  const haystack = streamHaystack(stream);
  if (metaId) {
    const normalized = metaId.toLowerCase();
    if (haystack.includes(normalized)) return true;
    if (normalized.startsWith('tt') && normalized.length > 4) {
      const digits = normalized.slice(2);
      if (haystack.includes(digits)) return true;
    }
  }

  const tokens = metaTitleTokens(metaTitle);
  if (tokens.length < 2) return true;
  const sorted = [...tokens].sort((left, right) => right.length - left.length);
  const primary = sorted[0];
  if (primary.length >= 5 && !TITLE_STOP_WORDS.has(primary) && haystack.includes(primary)) {
    return true;
  }
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits >= 2;
}

export function isSeriesPackForMovie(stream: Stream, contentType: string | undefined): boolean {
  if (contentType !== 'movie') return false;
  const haystack = streamHaystack(stream);
  return /\b(s\d{1,2}e\d{1,2}|\.s\d{1,2}\.|season\s*\d|complete.*\bs\d{1,2}\b|series)\b/i.test(haystack);
}

function defaultAutoPlayTiers(): AutoPlayTier[] {
  return [
    {
      addons: ['AIOStreams'],
      require_cache: 'cached',
      debrid_services: ['torbox'],
    },
    {
      addons: ['AIOStreams'],
      require_cache: 'cached',
      debrid_services: ['torbox', 'realdebrid'],
    },
    {
      addons: ['Torrentio TB'],
      require_cache: 'any',
    },
    {
      addons: ['Torrentio RD'],
      require_cache: 'cached',
      debrid_services: ['realdebrid'],
    },
  ];
}

function parseAutoPlayRequireCache(value: unknown): AutoPlayCacheRequirement | null {
  if (value === 'cached' || value === 'cached_or_unknown' || value === 'any') {
    return value;
  }
  return null;
}

function parseAutoPlayTiers(value: unknown): AutoPlayTier[] {
  if (!Array.isArray(value)) return defaultAutoPlayTiers();
  const tiers: AutoPlayTier[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const addons = Array.isArray(record.addons)
      ? record.addons
          .filter((addon): addon is string => typeof addon === 'string' && addon.trim() !== '')
          .map((addon) => addon.trim())
      : [];
    const requireCache = parseAutoPlayRequireCache(record.require_cache);
    if (addons.length === 0 || !requireCache) continue;
    const debridServices = Array.isArray(record.debrid_services)
      ? record.debrid_services
          .filter((service): service is string => typeof service === 'string' && service.trim() !== '')
          .map((service) => service.trim().toLowerCase())
      : undefined;
    tiers.push({
      addons,
      require_cache: requireCache,
      ...(debridServices && debridServices.length > 0 ? { debrid_services: debridServices } : {}),
    });
  }
  return tiers.length > 0 ? tiers : defaultAutoPlayTiers();
}

function parseStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim().toLowerCase());
  return items.length > 0 ? items : fallback;
}

function streamHaystack(stream: Stream): string {
  return `${stream.title || ''} ${stream.description || ''} ${stream.name || ''}`.toLowerCase();
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

/** AIOStreams autoplay bingeGroup: addonId|service|cached|resolution|... */
export function parseDebridCacheStatus(stream: Stream): 'cached' | 'uncached' | 'unknown' {
  const haystack = streamHaystack(stream);
  if (/\bnot cached\b|\buncached\b/.test(haystack)) return 'uncached';
  if (/\bcached\b/.test(haystack) && !/\bnot cached\b|\buncached\b/.test(haystack)) return 'cached';

  const group = bingeGroup(stream);
  if (!group?.startsWith('com.aiostreams')) return 'unknown';

  const parts = group.split('|');
  if (parts.length < 3) return 'unknown';

  const service = parts[1]?.toLowerCase();
  if (!service || !DEBRID_SERVICE_IDS.has(service)) return 'unknown';

  const flag = parts[2]?.toLowerCase();
  if (flag === 'true') return 'cached';
  if (flag === 'false') return 'uncached';
  return 'unknown';
}

export function streamQuality(stream: Stream): QualityCap | null {
  if (stream.quality) {
    const parsed = parseQualityCap(stream.quality);
    if (parsed) return parsed;
  }
  const match = streamHaystack(stream).match(/\b(2160p|4k|1080p|720p|480p)\b/);
  return match ? parseQualityCap(match[1]) : null;
}

function isRemux(stream: Stream): boolean {
  return /\bremux\b|\bblu[- ]?ray\b.*\bremux\b/i.test(streamHaystack(stream));
}

export function isErrorStream(stream: Stream): boolean {
  const haystack = streamHaystack(stream);
  return /\[❌\]|\[x\]|search failed|not found|no streams|error:|stream not found|being downloaded|downloading to debrid|download pending/i.test(haystack);
}

export function isRdBlockedRelease(stream: Stream, tags: string[]): boolean {
  if (debridServiceId(stream) !== 'realdebrid' || tags.length === 0) return false;
  const haystack = streamHaystack(stream);
  return tags.some((tag) => haystack.includes(tag.toLowerCase()));
}

/** Cam / telesync / screener — poor couch experience; skip uncached fallback. */
export function isLowQualityRelease(stream: Stream): boolean {
  const haystack = streamHaystack(stream);
  return /\b(hdcam|hd[\s-]?cam|camrip|cam[\s-]?rip|telesync|dvdscr|dvd[\s-]?scr|workprint)\b/i.test(haystack)
    || /\b(ts|scr|tc)\b/i.test(haystack);
}

/** Unknown-cache RD encode unlikely to hit May-2026 keyword filter. */
export function isRdSafeUnknownRelease(stream: Stream, tags: string[]): boolean {
  if (debridServiceId(stream) !== 'realdebrid') return false;
  if (parseDebridCacheStatus(stream) !== 'unknown') return false;
  if (isRdBlockedRelease(stream, tags)) return false;
  if (isLowQualityRelease(stream)) return false;
  const haystack = streamHaystack(stream);
  return /\b(bluray|blu[\s-]?ray|bdrip|bd[\s-]?rip|x265|hevc|10bit|aac)\b/i.test(haystack);
}

/**
 * Higher = try sooner. Weights encode couch hit-rate policy:
 * cache certainty → debrid safety (TB) → source reliability → release tier → quality fit.
 */
export function streamPlayScore(
  stream: Stream,
  config: StreamFilterConfig & { include_uncached: boolean },
  verifiedHint?: VerifiedStreamHint,
): number {
  let score = 0;
  const cache = streamCacheStatus(stream);
  if (cache === 'cached') score += 1000;
  else if (cache === 'unknown') score += 500;
  else if (cache === 'uncached') score += 200;

  const debrid = debridServiceId(stream);
  if (debrid === 'torbox') score += 120;
  else if (debrid === 'realdebrid') score += 40;

  const source = normalizeAddonName(stream.source || '');
  if (source.includes('torrentio tb')) score += 100;
  else if (source.includes('torrentio rd')) score += 70;
  else if (source.includes('aiostreams')) score += 20;

  // Unknown-cache Torrentio TB rows are usually instant hash-on-debrid; RD unknown often serves 30s status clips.
  if (cache === 'unknown' && source.includes('torrentio tb')) score += 120;

  const haystack = streamHaystack(stream);
  if (/\b(bluray|blu[\s-]?ray|bdrip)\b/i.test(haystack)) score += 50;
  else if (/\bweb[\s-]?dl\b/i.test(haystack)) score += 25;
  else if (/\bwebrip\b/i.test(haystack)) score += 10;
  if (isLowQualityRelease(stream)) score -= 200;

  const quality = streamQuality(stream);
  if (quality === '1080p') score += 30;
  else if (quality === '720p') score += 15;
  else if (quality === '480p') score += 5;

  if (config.max_quality && quality) {
    score -= qualityRank(stream, config.max_quality);
  }

  if (verifiedHint) {
    if (verifiedHint.win_url_hash) {
      const hash = createHash('sha256').update(stream.url).digest('hex').slice(0, 16);
      if (hash === verifiedHint.win_url_hash) score += 5000;
    }
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

function debridPreferenceRank(service: string | null, preference: string[]): number {
  if (!service) return preference.length + 1;
  const index = preference.indexOf(service);
  return index === -1 ? preference.length : index;
}

function qualityExceedsCap(stream: Stream, cap: QualityCap | null): boolean {
  if (!cap) return false;
  const quality = streamQuality(stream);
  if (!quality) return false;
  return QUALITY_ORDER[quality] > QUALITY_ORDER[cap];
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
    auto_play_max_attempts: positiveInteger(process.env.MANGO_AUTO_PLAY_MAX_ATTEMPTS, 5, 1, 10),
    auto_play_wall_ms: positiveInteger(process.env.MANGO_AUTO_PLAY_WALL_MS, 15000, 1000, 60000),
    auto_play_probe_ms: positiveInteger(process.env.MANGO_AUTO_PLAY_PROBE_MS, 4000, 500, 15000),
    auto_play_tiers: defaultAutoPlayTiers(),
    debrid_preference: DEFAULT_DEBRID_PREFERENCE,
    exclude_rd_release_tags: DEFAULT_RD_BLOCKED_TAGS,
    exclude_error_streams: true,
    uncached_torbox_fallback: true,
    rd_safe_unknown_fallback: true,
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
      base.auto_play_max_attempts = positiveInteger(raw.auto_play_max_attempts, base.auto_play_max_attempts, 1, 10);
    }
    if (raw.auto_play_wall_ms !== undefined) {
      base.auto_play_wall_ms = positiveInteger(raw.auto_play_wall_ms, base.auto_play_wall_ms, 1000, 60000);
    }
    if (raw.auto_play_probe_ms !== undefined) {
      base.auto_play_probe_ms = positiveInteger(raw.auto_play_probe_ms, base.auto_play_probe_ms, 500, 15000);
    }
    if (raw.auto_play_tiers !== undefined) {
      base.auto_play_tiers = parseAutoPlayTiers(raw.auto_play_tiers);
    }
    if (raw.debrid_preference !== undefined) {
      base.debrid_preference = parseStringList(raw.debrid_preference, base.debrid_preference);
    }
    if (raw.exclude_rd_release_tags !== undefined) {
      base.exclude_rd_release_tags = parseStringList(raw.exclude_rd_release_tags, base.exclude_rd_release_tags);
    }
    if (typeof raw.exclude_error_streams === 'boolean') {
      base.exclude_error_streams = raw.exclude_error_streams;
    }
    if (typeof raw.uncached_torbox_fallback === 'boolean') {
      base.uncached_torbox_fallback = raw.uncached_torbox_fallback;
    }
    if (typeof raw.rd_safe_unknown_fallback === 'boolean') {
      base.rd_safe_unknown_fallback = raw.rd_safe_unknown_fallback;
    }
    if (raw.include_uncached === true) {
      base.exclude_uncached_debrid = false;
    }
  } catch {
    // optional file — env defaults apply
  }
  return base;
}

export function mergeFilterConfig(
  base: StreamFilterConfig,
  overrides: StreamFilterOverrides = {},
): StreamFilterConfig & { include_uncached: boolean } {
  const includeUncached = overrides.include_uncached === true;
  return {
    exclude_uncached_debrid: includeUncached ? false : base.exclude_uncached_debrid,
    strict_unknown_cache: overrides.strict_unknown_cache ?? base.strict_unknown_cache,
    max_quality: overrides.max_quality !== undefined ? overrides.max_quality : base.max_quality,
    exclude_remux: overrides.exclude_remux ?? base.exclude_remux,
    auto_play_max_attempts: base.auto_play_max_attempts,
    auto_play_wall_ms: base.auto_play_wall_ms,
    auto_play_probe_ms: base.auto_play_probe_ms,
    auto_play_tiers: base.auto_play_tiers,
    debrid_preference: base.debrid_preference,
    exclude_rd_release_tags: base.exclude_rd_release_tags,
    exclude_error_streams: base.exclude_error_streams,
    uncached_torbox_fallback: base.uncached_torbox_fallback,
    rd_safe_unknown_fallback: base.rd_safe_unknown_fallback,
    include_uncached: includeUncached,
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
  return overrides;
}

function cacheRank(status: ReturnType<typeof parseDebridCacheStatus>): number {
  if (status === 'cached') return 0;
  if (status === 'unknown') return 1;
  return 2;
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
      rd_blocked_release: 0,
      title_mismatch: 0,
      series_pack_for_movie: 0,
    },
  };

  const kept: Stream[] = [];
  for (const stream of streams) {
    const debrid = isDebridStream(stream);
    const cacheStatus = parseDebridCacheStatus(stream);

    if (context.metaTitle && !streamMatchesMetaTitle(stream, context.metaTitle, context.metaId)) {
      meta.excluded.title_mismatch += 1;
      continue;
    }
    if (isSeriesPackForMovie(stream, context.contentType)) {
      meta.excluded.series_pack_for_movie += 1;
      continue;
    }
    if (config.exclude_error_streams && isErrorStream(stream)) {
      meta.excluded.error_stream += 1;
      continue;
    }
    if (isRdBlockedRelease(stream, config.exclude_rd_release_tags)) {
      meta.excluded.rd_blocked_release += 1;
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
    if (debrid && config.exclude_uncached_debrid) {
      if (cacheStatus === 'uncached') {
        meta.excluded.uncached_debrid += 1;
        continue;
      }
      if (cacheStatus === 'unknown' && config.strict_unknown_cache) {
        meta.excluded.unknown_cache_debrid += 1;
        continue;
      }
    }
    if (isTorrentioRealDebridStream(stream) && cacheStatus !== 'cached') {
      meta.excluded.uncached_debrid += 1;
      continue;
    }

    kept.push({
      ...stream,
      debrid_service: debridServiceId(stream) ?? undefined,
      cache_status: cacheStatus,
    });
  }

  rankKeptStreams(kept, config);

  meta.kept = kept.length;
  return { streams: kept, meta };
}

function rankKeptStreams(
  kept: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
): void {
  kept.sort((left, right) => streamPlayScore(right, config) - streamPlayScore(left, config));
}

function buildFallbackStreams(
  streams: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
  predicate: (stream: Stream) => boolean,
  annotate: (stream: Stream) => Stream,
  context: StreamFilterContext = {},
): Stream[] {
  const kept: Stream[] = [];
  for (const stream of streams) {
    if (!predicate(stream)) continue;
    if (context.metaTitle && !streamMatchesMetaTitle(stream, context.metaTitle, context.metaId)) {
      continue;
    }
    if (isSeriesPackForMovie(stream, context.contentType)) continue;
    if (config.exclude_error_streams && isErrorStream(stream)) continue;
    if (config.exclude_remux && isRemux(stream)) continue;
    if (qualityExceedsCap(stream, config.max_quality)) continue;
    kept.push(annotate(stream));
  }
  rankKeptStreams(kept, config);
  return kept;
}

/** Primary filters; cascade to TorBox uncached then RD safe-unknown when empty. */
export function filterStreamsForPlay(
  streams: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
  context: StreamFilterContext = {},
): { streams: Stream[]; meta: StreamFilterMeta } {
  const primary = filterAndRankStreams(streams, config, context);
  if (primary.streams.length > 0 || config.include_uncached) {
    return primary;
  }

  if (primary.meta.excluded.title_mismatch > 0 && context.metaTitle) {
    const relaxed = filterAndRankStreams(streams, config, {
      ...context,
      metaTitle: undefined,
    });
    if (relaxed.streams.length > 0) {
      return {
        streams: relaxed.streams,
        meta: {
          ...relaxed.meta,
          title_filter_relaxed: true,
        },
      };
    }
  }

  if (config.uncached_torbox_fallback) {
    const torboxUncached = buildFallbackStreams(
      streams,
      config,
      (stream) => debridServiceId(stream) === 'torbox' && parseDebridCacheStatus(stream) === 'uncached',
      (stream) => ({
        ...stream,
        debrid_service: 'torbox',
        cache_status: parseDebridCacheStatus(stream),
      }),
      context,
    ).filter((stream) => !isLowQualityRelease(stream));

    if (torboxUncached.length > 0) {
      return {
        streams: torboxUncached,
        meta: {
          ...primary.meta,
          kept: torboxUncached.length,
          torbox_uncached_fallback: true,
        },
      };
    }
  }

  if (config.rd_safe_unknown_fallback) {
    const rdSafe = buildFallbackStreams(
      streams,
      config,
      (stream) => isRdSafeUnknownRelease(stream, config.exclude_rd_release_tags),
      (stream) => ({
        ...stream,
        debrid_service: 'realdebrid',
        cache_status: 'unknown',
      }),
      context,
    );

    if (rdSafe.length > 0) {
      return {
        streams: rdSafe,
        meta: {
          ...primary.meta,
          kept: rdSafe.length,
          rd_safe_unknown_fallback: true,
        },
      };
    }
  }

  return primary;
}

function isTorrentioRealDebridStream(stream: Stream): boolean {
  const source = normalizeAddonName(stream.source || '');
  if (source.includes('torrentio rd')) return true;
  return source.includes('torrentio') && debridServiceId(stream) === 'realdebrid';
}

function normalizeAddonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\|\s*/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceMatches(stream: Stream, addons: string[]): boolean {
  const source = normalizeAddonName(stream.source || '');
  return addons.some((addon) => normalizeAddonName(addon) === source);
}

function streamCacheStatus(stream: Stream): ReturnType<typeof parseDebridCacheStatus> {
  const explicit = stream.cache_status;
  if (explicit === 'cached' || explicit === 'uncached' || explicit === 'unknown') {
    return explicit;
  }
  return parseDebridCacheStatus(stream);
}

function cacheAllowed(
  stream: Stream,
  requireCache: AutoPlayCacheRequirement,
  strictUnknownCache: boolean,
): boolean {
  const status = streamCacheStatus(stream);
  if (requireCache === 'any') return status !== 'uncached';
  if (requireCache === 'cached') return status === 'cached';
  if (status === 'cached') return true;
  return status === 'unknown' && !strictUnknownCache;
}

function debridServiceAllowed(stream: Stream, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  const service = debridServiceId(stream);
  if (!service) return false;
  return allowed.includes(service);
}

function autoPlayEligible(
  stream: Stream,
  config: StreamFilterConfig & { include_uncached: boolean },
  options: { allow_uncached_torbox?: boolean } = {},
): boolean {
  if (config.exclude_error_streams && isErrorStream(stream)) return false;
  if (isRdBlockedRelease(stream, config.exclude_rd_release_tags)) return false;
  if (
    isTorrentioRealDebridStream(stream)
    && streamCacheStatus(stream) !== 'cached'
    && !isRdSafeUnknownRelease(stream, config.exclude_rd_release_tags)
  ) {
    return false;
  }
  if (isDebridStream(stream) && streamCacheStatus(stream) === 'uncached') {
    if (options.allow_uncached_torbox && debridServiceId(stream) === 'torbox') {
      return true;
    }
    return false;
  }
  return true;
}

export function selectAutoPlayCandidates(
  streams: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
  options: { allow_uncached_torbox?: boolean; verified_hint?: VerifiedStreamHint } = {},
): Stream[] {
  const eligible = streams.filter((stream) => autoPlayEligible(stream, config, options));
  const phases: Array<(stream: Stream) => boolean> = [
    (stream) => streamCacheStatus(stream) === 'cached',
    (stream) => streamCacheStatus(stream) === 'unknown',
    (stream) => options.allow_uncached_torbox === true
      && debridServiceId(stream) === 'torbox'
      && streamCacheStatus(stream) === 'uncached'
      && !isLowQualityRelease(stream),
  ];

  const seen = new Set<string>();
  const ranked: Stream[] = [];

  for (const phase of phases) {
    const phaseStreams = eligible
      .filter((stream) => !seen.has(stream.url) && phase(stream))
      .sort((left, right) => streamPlayScore(right, config, options.verified_hint)
        - streamPlayScore(left, config, options.verified_hint));
    for (const stream of phaseStreams) {
      seen.add(stream.url);
      ranked.push(stream);
    }
  }

  return diversifyCandidates(ranked, config.auto_play_max_attempts);
}

/** Spread attempts across addons/cache phases instead of four near-identical AIOStreams rows. */
function diversifyCandidates(streams: Stream[], max: number): Stream[] {
  if (streams.length <= max) return streams;

  const buckets = new Map<string, Stream[]>();
  for (const stream of streams) {
    const key = `${normalizeAddonName(stream.source || '')}|${streamCacheStatus(stream)}|${debridServiceId(stream) || 'none'}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(stream);
    buckets.set(key, bucket);
  }

  const picked: Stream[] = [];
  const seen = new Set<string>();
  while (picked.length < max) {
    let added = false;
    for (const bucket of buckets.values()) {
      if (bucket.length === 0) continue;
      const stream = bucket.shift();
      if (!stream || seen.has(stream.url)) continue;
      seen.add(stream.url);
      picked.push(stream);
      added = true;
      if (picked.length >= max) break;
    }
    if (!added) break;
  }

  if (picked.length < max) {
    for (const stream of streams) {
      if (seen.has(stream.url)) continue;
      picked.push(stream);
      if (picked.length >= max) break;
    }
  }

  return picked;
}

export function pickPlayableStream(
  streams: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
  context: StreamFilterContext = {},
): { stream: Stream | null; meta: StreamFilterMeta } {
  const { streams: filtered, meta } = filterAndRankStreams(streams, config, context);
  return { stream: filtered[0] ?? null, meta };
}

import type { Stream } from './core.js';
import {
  debridServiceId,
  enrichStreamMetadata,
  isDebridStream,
  isErrorStream,
  isLowQualityRelease,
  isRdSafeUnknownRelease,
  isRemux,
  isSeriesPackForMovie,
  isSupplementalRelease,
  parseDebridCacheStatus,
  sourceMatches,
  streamMatchesLanguage,
  streamPassesIntegrity,
  streamMatchesVerifiedHint,
  streamPlayScore,
  streamQuality,
  type QualityCap,
  type StreamFilterContext,
  type VerifiedStreamHint,
} from './stream-filters.js';

export type PlayLadderCacheRequirement = 'cached' | 'cached_or_uncached' | 'cached_or_unknown' | 'any';

export type PlayLadderStep = {
  /** Stable id stored in playability.db (e.g. ideal, 2160p_encode). */
  step: string;
  max_quality: QualityCap | null;
  exclude_remux: boolean;
  require_cache: PlayLadderCacheRequirement;
  debrid_services?: string[];
  /** Allow RD unknown-cache BluRay/x265 at this step only. */
  rd_safe_unknown?: boolean;
  addons?: string[];
};

export type LadderCandidate = {
  stream: Stream;
  ladder_step: string;
};

export type PlayLadderConfig = {
  preferred_quality: QualityCap;
  play_ladder: PlayLadderStep[];
};

const DEFAULT_ADDONS = ['AIOStreams'];

function ensureEnriched(stream: Stream): Stream {
  if (typeof stream.display_label === 'string' && stream.display_label.trim() !== '') {
    return stream;
  }
  return enrichStreamMetadata(stream);
}

export function defaultPlayLadder(): PlayLadderStep[] {
  return [
    {
      step: 'ideal',
      max_quality: '1080p',
      exclude_remux: true,
      require_cache: 'cached',
      debrid_services: ['torbox'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: '1080p_uncached',
      max_quality: '1080p',
      exclude_remux: true,
      require_cache: 'cached_or_uncached',
      debrid_services: ['torbox'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: '1080p_remux',
      max_quality: '1080p',
      exclude_remux: false,
      require_cache: 'cached',
      debrid_services: ['torbox'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: '2160p_encode',
      max_quality: '2160p',
      exclude_remux: true,
      require_cache: 'cached_or_uncached',
      debrid_services: ['torbox', 'realdebrid'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: 'last_resort',
      max_quality: '2160p',
      exclude_remux: false,
      require_cache: 'any',
      debrid_services: ['torbox', 'realdebrid'],
      rd_safe_unknown: true,
      addons: DEFAULT_ADDONS,
    },
  ];
}

function parseQuality(value: unknown): QualityCap | null {
  if (value === null) return null;
  if (value === '480p' || value === '720p' || value === '1080p' || value === '2160p') {
    return value;
  }
  return null;
}

function parseCacheRequirement(value: unknown): PlayLadderCacheRequirement {
  if (value === 'cached' || value === 'cached_or_uncached' || value === 'cached_or_unknown' || value === 'any') {
    return value;
  }
  return 'cached';
}

export function parsePlayLadder(raw: unknown): PlayLadderStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return defaultPlayLadder();
  }
  const parsed: PlayLadderStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const step = typeof row.step === 'string' ? row.step.trim() : '';
    if (!step) continue;
    parsed.push({
      step,
      max_quality: parseQuality(row.max_quality) ?? '1080p',
      exclude_remux: row.exclude_remux !== false,
      require_cache: parseCacheRequirement(row.require_cache),
      debrid_services: Array.isArray(row.debrid_services)
        ? row.debrid_services.map(String)
        : ['torbox'],
      rd_safe_unknown: row.rd_safe_unknown === true,
      addons: Array.isArray(row.addons) ? row.addons.map(String) : DEFAULT_ADDONS,
    });
  }
  return parsed.length > 0 ? parsed : defaultPlayLadder();
}

function qualityExceedsCap(stream: Stream, cap: QualityCap | null): boolean {
  if (!cap) return false;
  const quality = streamQuality(stream);
  if (!quality) return false;
  const order: Record<QualityCap, number> = { '480p': 480, '720p': 720, '1080p': 1080, '2160p': 2160 };
  return order[quality] > order[cap];
}

function cacheMatchesRequirement(
  cacheStatus: ReturnType<typeof parseDebridCacheStatus>,
  requirement: PlayLadderCacheRequirement,
  strictUnknown: boolean,
): boolean {
  switch (requirement) {
    case 'cached':
      return cacheStatus === 'cached';
    case 'cached_or_uncached':
      return cacheStatus === 'cached' || cacheStatus === 'uncached';
    case 'cached_or_unknown':
      if (cacheStatus === 'cached' || cacheStatus === 'uncached') return true;
      return cacheStatus === 'unknown' && !strictUnknown;
    case 'any':
      if (cacheStatus === 'unknown' && strictUnknown) return false;
      return true;
    default:
      return false;
  }
}

function debridAllowed(stream: Stream, services: string[] | undefined): boolean {
  if (!services || services.length === 0) return true;
  const service = debridServiceId(stream);
  if (!service) return false;
  return services.includes(service);
}

export function streamMatchesLadderStep(
  stream: Stream,
  step: PlayLadderStep,
  options: { strict_unknown_cache?: boolean } = {},
): boolean {
  const enriched = ensureEnriched(stream);
  if (!sourceMatches(enriched, step.addons ?? DEFAULT_ADDONS)) return false;
  if (step.exclude_remux && isRemux(enriched)) return false;
  if (qualityExceedsCap(enriched, step.max_quality)) return false;
  if (isLowQualityRelease(enriched)) return false;
  if (isErrorStream(enriched)) return false;

  const debrid = isDebridStream(enriched);
  const cacheStatus = parseDebridCacheStatus(enriched);

  if (debrid) {
    if (!debridAllowed(enriched, step.debrid_services)) return false;
    if (!cacheMatchesRequirement(cacheStatus, step.require_cache, options.strict_unknown_cache !== false)) {
      if (step.rd_safe_unknown && isRdSafeUnknownRelease(enriched)) {
        return true;
      }
      return false;
    }
  }

  if (step.rd_safe_unknown && isRdSafeUnknownRelease(enriched)) {
    return true;
  }

  return true;
}

export function filterStreamsForLadderStep(
  streams: Stream[],
  step: PlayLadderStep,
  context: StreamFilterContext = {},
  options: {
    strict_unknown_cache?: boolean;
    hard_language?: string | null;
    preferred_quality?: QualityCap | null;
    verified_hint?: VerifiedStreamHint;
  } = {},
): Stream[] {
  const kept: Stream[] = [];
  for (const raw of streams) {
    const stream = ensureEnriched(raw);
    if (!streamPassesIntegrity(stream, context)) {
      continue;
    }
    if (isSeriesPackForMovie(stream, context.contentType)) continue;
    if (isSupplementalRelease(stream, context.contentType)) continue;
    if (options.hard_language && !streamMatchesLanguage(stream, options.hard_language)) continue;
    if (!streamMatchesLadderStep(stream, step, options)) continue;

    kept.push({
      ...stream,
      debrid_service: debridServiceId(stream) ?? undefined,
      cache_status: parseDebridCacheStatus(stream),
    });
  }

  const scoreConfig = {
    exclude_uncached_debrid: step.require_cache === 'cached',
    strict_unknown_cache: options.strict_unknown_cache !== false,
    max_quality: step.max_quality,
    exclude_remux: step.exclude_remux,
    exclude_error_streams: true,
    stream_display_limit: 99,
    uncached_torbox_fallback: false,
    rd_safe_unknown_fallback: false,
    auto_play_max_attempts: 99,
    auto_play_wall_ms: 90000,
    auto_play_probe_ms: 8000,
    auto_play_uncached_probe_ms: 25000,
    preferred_quality: options.preferred_quality ?? '1080p',
    play_ladder: [],
    auto_play_tiers: [],
    include_uncached: step.require_cache !== 'cached',
  } as import('./stream-filters.js').StreamFilterConfig & { include_uncached: boolean };

  kept.sort((left, right) => streamPlayScore(right, scoreConfig, options.verified_hint, {
    preferred_language: null,
  }) - streamPlayScore(left, scoreConfig, options.verified_hint, {
    preferred_language: null,
  }));

  if (options.verified_hint?.win_url_hash) {
    kept.sort((left, right) => {
      const leftMatch = streamMatchesVerifiedHint(left, options.verified_hint) ? 1 : 0;
      const rightMatch = streamMatchesVerifiedHint(right, options.verified_hint) ? 1 : 0;
      return rightMatch - leftMatch;
    });
  }

  return kept;
}

/** Ordered play candidates across ladder steps — deduped by URL, capped globally. */
export function expandPlayLadder(
  streams: Stream[],
  ladder: PlayLadderStep[],
  context: StreamFilterContext = {},
  options: {
    strict_unknown_cache?: boolean;
    hard_language?: string | null;
    preferred_quality?: QualityCap | null;
    verified_hint?: VerifiedStreamHint;
    max_candidates?: number;
    include_uncached?: boolean;
    /** When set, prefer candidates from this ladder step (verify hint). */
    prefer_ladder_step?: string | null;
  } = {},
): LadderCandidate[] {
  const max = options.max_candidates ?? 12;
  const seen = new Set<string>();
  const ranked: LadderCandidate[] = [];

  const pushStep = (step: PlayLadderStep): void => {
    const stepStreams = filterStreamsForLadderStep(streams, step, context, options);
    for (const stream of stepStreams) {
      if (options.include_uncached === false && parseDebridCacheStatus(stream) === 'uncached') {
        continue;
      }
      if (seen.has(stream.url)) continue;
      seen.add(stream.url);
      ranked.push({ stream, ladder_step: step.step });
      if (ranked.length >= max) return;
    }
  };

  if (options.prefer_ladder_step) {
    const preferred = ladder.find((step) => step.step === options.prefer_ladder_step);
    if (preferred) pushStep(preferred);
  }

  for (const step of ladder) {
    if (ranked.length >= max) break;
    if (step.step === options.prefer_ladder_step) continue;
    pushStep(step);
  }

  return ranked.slice(0, max);
}

export function couchStatusForLadderStep(step: string): string {
  switch (step) {
    case 'ideal':
      return 'trying best match…';
    case '1080p_uncached':
      return 'caching stream on TorBox…';
    case '1080p_remux':
      return 'trying alternate 1080p release…';
    case '2160p_encode':
      return 'trying higher-quality encode…';
    case 'last_resort':
      return 'trying alternate release…';
    default:
      return 'finding stream…';
  }
}

export function enrichStreams(streams: Stream[]): Stream[] {
  return streams.map((stream) => (
    typeof stream.display_label === 'string' && stream.display_label.trim() !== ''
      ? stream
      : enrichStreamMetadata(stream)
  ));
}

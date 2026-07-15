import type { Stream } from './core.js';
import { isSupplementalStream } from './bonus-stream-resolve.js';
import {
  debridServiceId,
  enrichStreamMetadata,
  isDebridStream,
  isErrorStream,
  isExcludedUncachedRealDebrid,
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
  streamUrlHash,
  streamStableIdentity,
  streamIsHevc,
  streamIsHdr,
  effectiveStreamQualityRank,
  type QualityCap,
  type StreamFilterContext,
  type VerifiedStreamHint,
} from './stream-filters.js';

function rejectSupplementalForMainEpisode(
  stream: Stream,
  context: StreamFilterContext,
): boolean {
  if (isSupplementalRelease(stream, context.contentType)) {
    return true;
  }
  // Series main episodes must not pick BTS / deleted / discarded packs.
  if ((context.contentType || '').toLowerCase() === 'series' && context.episodeRole !== 'bonus') {
    return isSupplementalStream(stream);
  }
  return false;
}

export type PlayLadderCacheRequirement = 'cached' | 'cached_or_uncached' | 'cached_or_unknown' | 'any';

export type PlayLadderStep = {
  /** Stable id stored in playability.db (e.g. ideal, 2160p_encode). */
  step: string;
  max_quality: QualityCap | null;
  min_quality?: QualityCap | null;
  exclude_remux: boolean;
  /** Require HEVC for streams above 1080p (Pi 5 has no >1080p software-smooth path). */
  require_hevc?: boolean;
  /** Drop HDR streams above 1080p (X11 can't output HDR; 4K HDR tone-map stutters). */
  exclude_hdr?: boolean;
  require_cache: PlayLadderCacheRequirement;
  debrid_services?: string[];
  /** Allow RD unknown-cache BluRay/x265 at this step only. */
  rd_safe_unknown?: boolean;
  addons?: string[];
  /**
   * When true, eligible for the verified side-list (GET /stream).
   * When false, play-only (soft 4K / last_resort / uncached).
   * When omitted, inferred from step id defaults.
   */
  verified?: boolean;
};

/** Smooth / couch-trustworthy steps shown as verified in the detail side-list. */
const VERIFIED_DISPLAY_STEP_IDS = new Set([
  'ideal',
  '1080p_remux',
  '1080p_hevc_cached',
  '1080p_cached_fallback',
  '1080p_cached',
  '4k_sdr_remux_cached',
  '4k_sdr_cached',
  '2160p_encode',
  '2160p_cached',
  '2160p_hdr_cached',
]);

/** Play-only / unverified steps — never expand into the verified display ladder. */
const UNVERIFIED_DISPLAY_STEP_IDS = new Set([
  'last_resort',
  '4k_sdr_soft_cached',
  '1080p_uncached_fallback',
  '1080p_uncached',
  'obligation_floor',
]);

export function isVerifiedDisplayStep(step: PlayLadderStep | string): boolean {
  if (typeof step === 'string') {
    if (UNVERIFIED_DISPLAY_STEP_IDS.has(step)) return false;
    if (VERIFIED_DISPLAY_STEP_IDS.has(step)) return true;
    // Unknown custom preference steps stay displayable unless marked unverified.
    return true;
  }
  if (step.verified === false) return false;
  if (step.verified === true) return true;
  return isVerifiedDisplayStep(step.step);
}

/** Preference steps eligible for the verified GET /stream side-list. */
export function displayLadderFromPlayLadder(ladder: PlayLadderStep[]): PlayLadderStep[] {
  return ladder.filter((step) => isVerifiedDisplayStep(step));
}

/** Default main ladder — smooth cached steps only (Q1A / Q2A). */
export function defaultMainLadder(): PlayLadderStep[] {
  return defaultPlayLadder().filter((step) => isVerifiedDisplayStep(step));
}

/** Default last-resort — may stutter; never used for grow verify. */
export function defaultLastResortLadder(): PlayLadderStep[] {
  const fromDefault = defaultPlayLadder().filter((step) => !isVerifiedDisplayStep(step));
  if (fromDefault.length > 0) return fromDefault;
  return [{
    step: 'last_resort',
    max_quality: '2160p',
    exclude_remux: false,
    require_hevc: false,
    require_cache: 'any',
    debrid_services: ['torbox', 'realdebrid'],
    rd_safe_unknown: true,
    addons: DEFAULT_ADDONS,
    verified: false,
  }];
}

/** Split a legacy single play_ladder by verified/display membership. */
export function splitLegacyPlayLadder(ladder: PlayLadderStep[]): {
  main_ladder: PlayLadderStep[];
  last_resort_ladder: PlayLadderStep[];
} {
  const main_ladder = ladder.filter((step) => isVerifiedDisplayStep(step));
  let last_resort_ladder = ladder.filter((step) => !isVerifiedDisplayStep(step));
  if (main_ladder.length === 0 && last_resort_ladder.length === 0) {
    return {
      main_ladder: defaultMainLadder(),
      last_resort_ladder: defaultLastResortLadder(),
    };
  }
  if (last_resort_ladder.length === 0) {
    last_resort_ladder = defaultLastResortLadder();
  }
  return {
    main_ladder: main_ladder.length > 0 ? main_ladder : defaultMainLadder(),
    last_resort_ladder,
  };
}

export function combinePlayLadders(
  main: PlayLadderStep[],
  lastResort: PlayLadderStep[],
): PlayLadderStep[] {
  return [...main, ...lastResort];
}

export function isMainLadderStep(step: string, mainLadder: PlayLadderStep[]): boolean {
  const id = step.trim();
  if (!id || id === 'obligation_floor' || id === 'picker') return false;
  return mainLadder.some((entry) => entry.step === id);
}

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
      debrid_services: ['torbox', 'realdebrid'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: '1080p_uncached',
      max_quality: '1080p',
      exclude_remux: true,
      require_cache: 'cached_or_uncached',
      // Uncached cache-in is TorBox-only (RD uncached excluded upstream).
      debrid_services: ['torbox'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: '1080p_remux',
      max_quality: '1080p',
      exclude_remux: false,
      require_cache: 'cached',
      debrid_services: ['torbox', 'realdebrid'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: '2160p_encode',
      max_quality: '2160p',
      exclude_remux: true,
      require_hevc: true,
      require_cache: 'cached_or_uncached',
      debrid_services: ['torbox', 'realdebrid'],
      addons: DEFAULT_ADDONS,
    },
    {
      step: 'last_resort',
      max_quality: '2160p',
      exclude_remux: false,
      require_hevc: true,
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
    const verified = row.verified === true ? true : row.verified === false ? false : undefined;
    parsed.push({
      step,
      max_quality: parseQuality(row.max_quality) ?? '1080p',
      min_quality: parseQuality(row.min_quality),
      exclude_remux: row.exclude_remux !== false,
      require_hevc: row.require_hevc === true,
      exclude_hdr: row.exclude_hdr === true,
      require_cache: parseCacheRequirement(row.require_cache),
      debrid_services: Array.isArray(row.debrid_services)
        ? row.debrid_services.map(String)
        : ['torbox'],
      rd_safe_unknown: row.rd_safe_unknown === true,
      addons: Array.isArray(row.addons) ? row.addons.map(String) : DEFAULT_ADDONS,
      ...(verified !== undefined ? { verified } : {}),
    });
  }
  return parsed.length > 0 ? parsed : defaultPlayLadder();
}

function qualityExceedsCap(stream: Stream, cap: QualityCap | null): boolean {
  if (!cap) return false;
  const order: Record<QualityCap, number> = { '480p': 480, '720p': 720, '1080p': 1080, '2160p': 2160 };
  const rank = effectiveStreamQualityRank(stream);
  if (rank === null) return false;
  return rank > order[cap];
}

function qualityBelowMin(stream: Stream, min: QualityCap | null | undefined): boolean {
  if (!min) return false;
  const order: Record<QualityCap, number> = { '480p': 480, '720p': 720, '1080p': 1080, '2160p': 2160 };
  const rank = effectiveStreamQualityRank(stream);
  // Explicit floors (e.g. 2160p HEVC remux) must not match unknown-quality streams —
  // otherwise thin MediaFusion rows with no resolution/codec land on verified 4K steps.
  if (rank === null) return true;
  return rank < order[min];
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
  if (qualityBelowMin(enriched, step.min_quality)) return false;
  if (step.require_hevc || step.exclude_hdr) {
    const rank = effectiveStreamQualityRank(enriched);
    const above1080 = rank !== null && rank > 1080;
    // Pi 5 hardware-decodes HEVC only. Above 1080p, a non-HEVC stream would
    // fall back to software decode (stutter), so drop it and let the ladder
    // continue to a 1080p (any-codec) step instead.
    // 4K-only steps (min_quality 2160p) also require proven HEVC when asked —
    // unknown-codec rows must not satisfy require_hevc.
    if (step.require_hevc && (above1080 || step.min_quality === '2160p') && !streamIsHevc(enriched)) {
      return false;
    }
    // X11 can't output HDR, so 4K HDR would be GPU tone-mapped to SDR every
    // frame — the Pi 5 can't sustain that at 4K. Drop HDR above 1080p so the
    // title falls through to a 1080p step (cheap tone-map) or an SDR 4K stream.
    if (above1080 && step.exclude_hdr && streamIsHdr(enriched)) return false;
  }
  if (isLowQualityRelease(enriched)) return false;
  if (isErrorStream(enriched)) return false;

  const debrid = isDebridStream(enriched);
  const cacheStatus = parseDebridCacheStatus(enriched);

  if (debrid) {
    if (isExcludedUncachedRealDebrid(enriched)) return false;
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
    preferred_hdr_tags?: string[];
    preferred_video_codecs?: string[];
    verified_hint?: VerifiedStreamHint;
    preferred_language?: string | null;
    min_quality?: QualityCap | null;
    max_quality?: QualityCap | null;
    exclude_remux?: boolean;
  } = {},
): Stream[] {
  const kept: Stream[] = [];
  for (const raw of streams) {
    const stream = ensureEnriched(raw);
    if (!streamPassesIntegrity(stream, context)) {
      continue;
    }
    if (isSeriesPackForMovie(stream, context.contentType)) continue;
    if (rejectSupplementalForMainEpisode(stream, context)) continue;
    if (options.hard_language && !streamMatchesLanguage(stream, options.hard_language)) continue;
    const effectiveStep = options.exclude_remux === undefined
      ? step
      : { ...step, exclude_remux: options.exclude_remux };
    if (!streamMatchesLadderStep(stream, effectiveStep, options)) continue;
    if (options.min_quality && qualityBelowMin(stream, options.min_quality)) continue;
    if (options.max_quality !== undefined && qualityExceedsCap(stream, options.max_quality)) continue;

    kept.push({
      ...stream,
      debrid_service: debridServiceId(stream) ?? undefined,
      cache_status: parseDebridCacheStatus(stream),
    });
  }

  const scoreConfig = {
    max_quality: step.max_quality,
    preferred_quality: options.preferred_quality ?? '1080p',
    preferred_hdr_tags: options.preferred_hdr_tags ?? [],
    preferred_video_codecs: options.preferred_video_codecs ?? [],
  };

  kept.sort((left, right) => streamPlayScore(right, scoreConfig, options.verified_hint, {
    preferred_language: options.preferred_language,
  }) - streamPlayScore(left, scoreConfig, options.verified_hint, {
    preferred_language: options.preferred_language,
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

/**
 * Max consecutive candidates from the same debrid service allowed in the
 * expanded ladder. Early default-ladder steps (ideal, 1080p_uncached,
 * 1080p_remux) are TB-only, so a flaky TorBox can otherwise burn the entire
 * `auto_play_max_attempts` budget on TB before a later, RD-inclusive step is
 * ever reached. Interleaving guarantees a secondary service gets attempt
 * slots within the budget without changing per-step quality ranking.
 */
const MAX_CONSECUTIVE_SAME_SERVICE = 3;

/**
 * Reorders candidates so no more than `maxRun` consecutive entries share the
 * same debrid service, promoting the earliest available different-service
 * candidate ahead of the run when one exists. Quality order *within* a
 * service is always preserved — this only interleaves *across* services.
 * No-ops when zero or one distinct service is present.
 */
function diversifyLadderCandidatesByService(
  candidates: LadderCandidate[],
  maxRun: number,
): LadderCandidate[] {
  if (candidates.length <= 1) return candidates.slice();

  const serviceOf = (candidate: LadderCandidate): string => debridServiceId(candidate.stream) ?? '__none__';
  const distinctServices = new Set(candidates.map(serviceOf));
  if (distinctServices.size <= 1) return candidates.slice();

  const remaining = candidates.slice();
  const result: LadderCandidate[] = [];
  let lastService: string | undefined;
  let runLength = 0;

  while (remaining.length > 0) {
    const next = remaining[0]!;
    const nextService = serviceOf(next);

    if (nextService === lastService && runLength >= maxRun) {
      const swapIndex = remaining.findIndex((candidate, idx) => idx > 0 && serviceOf(candidate) !== lastService);
      if (swapIndex > 0) {
        const [promoted] = remaining.splice(swapIndex, 1);
        result.push(promoted!);
        lastService = serviceOf(promoted!);
        runLength = 1;
        continue;
      }
      // No alternative service left in the remaining ladder — fall through
      // and keep walking the same-service run rather than starving it.
    }

    remaining.shift();
    result.push(next);
    if (nextService === lastService) {
      runLength += 1;
    } else {
      lastService = nextService;
      runLength = 1;
    }
  }

  return result;
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
    preferred_hdr_tags?: string[];
    preferred_video_codecs?: string[];
    verified_hint?: VerifiedStreamHint;
    max_candidates?: number;
    include_uncached?: boolean;
    preferred_language?: string | null;
    min_quality?: QualityCap | null;
    max_quality?: QualityCap | null;
    exclude_remux?: boolean;
    /** When set, prefer candidates from this ladder step (verify hint). */
    prefer_ladder_step?: string | null;
  } = {},
): LadderCandidate[] {
  const max = options.max_candidates ?? 12;
  const seen = new Set<string>();

  const pushStep = (step: PlayLadderStep, target: LadderCandidate[]): void => {
    const stepStreams = filterStreamsForLadderStep(streams, step, context, options);
    for (const stream of stepStreams) {
      if (options.include_uncached === false && parseDebridCacheStatus(stream) === 'uncached') {
        continue;
      }
      if (seen.has(stream.url)) continue;
      seen.add(stream.url);
      target.push({ stream, ladder_step: step.step });
    }
  };

  // The verify-hint "preferred step" candidate is an explicit continuation
  // pick, not a fresh ranking — keep it pinned first and out of the
  // service-diversification pass below.
  const preferredCandidates: LadderCandidate[] = [];
  if (options.prefer_ladder_step) {
    const preferred = ladder.find((step) => step.step === options.prefer_ladder_step);
    if (preferred) pushStep(preferred, preferredCandidates);
  }

  // Collect every matching candidate across all remaining steps (not just
  // the first `max`) so a later, RD-inclusive step's candidates are
  // available to interleave into the budget rather than being starved by
  // early TB-only steps filling `ranked` first.
  const restCandidates: LadderCandidate[] = [];
  for (const step of ladder) {
    if (step.step === options.prefer_ladder_step) continue;
    pushStep(step, restCandidates);
  }

  const diversifiedRest = diversifyLadderCandidatesByService(restCandidates, MAX_CONSECUTIVE_SAME_SERVICE);

  return [...preferredCandidates, ...diversifiedRest].slice(0, max);
}

/** Ensure an explicit picker URL is attempted even when ladder filters hid it from expansion. */
export function injectPreferredPlayCandidate(
  streams: Stream[],
  candidates: LadderCandidate[],
  preferUrl?: string,
  preferLadderStep?: string | null,
): LadderCandidate[] {
  if (!preferUrl || !/^https?:\/\//i.test(preferUrl)) {
    return candidates;
  }
  const hash = streamUrlHash(preferUrl);
  const match = streams.find((stream) => streamUrlHash(stream.url) === hash);
  if (!match) {
    return candidates;
  }
  const expanded = candidates.find((candidate) => streamUrlHash(candidate.stream.url) === hash);
  const preferStep = typeof preferLadderStep === 'string' ? preferLadderStep.trim() : '';
  const fromMatch = typeof match.ladder_step === 'string' ? match.ladder_step.trim() : '';
  const fromExpanded = typeof expanded?.ladder_step === 'string' ? expanded.ladder_step.trim() : '';
  const ladderStep = fromExpanded || fromMatch || preferStep || 'picker';
  const rest = candidates.filter((candidate) => streamUrlHash(candidate.stream.url) !== hash);
  return [{ stream: match, ladder_step: ladderStep }, ...rest];
}

export const OBLIGATION_FLOOR_STEP = 'obligation_floor';

/**
 * Couch play Phase B — integrity-safe streams with no ladder quality/cache/codec caps.
 * Excludes cam/ts, supplemental, wrong-title, error placeholders. Used only after
 * preference ladder exhaustion so any playable source gets a chance before 502.
 */
export function expandObligationFloor(
  streams: Stream[],
  context: StreamFilterContext = {},
  options: {
    excludeUrls?: Set<string>;
    maxCandidates?: number;
    hard_language?: string | null;
    preferred_language?: string | null;
    min_quality?: QualityCap | null;
    max_quality?: QualityCap | null;
    exclude_remux?: boolean;
  } = {},
): LadderCandidate[] {
  const max = options.maxCandidates ?? 6;
  const exclude = options.excludeUrls ?? new Set<string>();
  const kept: Stream[] = [];
  const seen = new Set<string>();

  for (const raw of streams) {
    const stream = ensureEnriched(raw);
    if (!stream.url || exclude.has(stream.url) || seen.has(stream.url)) continue;
    if (isExcludedUncachedRealDebrid(stream)) continue;
    if (!streamPassesIntegrity(stream, context)) continue;
    if (isSeriesPackForMovie(stream, context.contentType)) continue;
    if (rejectSupplementalForMainEpisode(stream, context)) continue;
    if (isErrorStream(stream)) continue;
    if (isLowQualityRelease(stream)) continue;
    if (options.hard_language && !streamMatchesLanguage(stream, options.hard_language)) continue;
    if (options.min_quality && qualityBelowMin(stream, options.min_quality)) continue;
    if (options.max_quality !== undefined && qualityExceedsCap(stream, options.max_quality)) continue;
    if (options.exclude_remux === true && isRemux(stream)) continue;

    seen.add(stream.url);
    kept.push({
      ...stream,
      debrid_service: debridServiceId(stream) ?? undefined,
      cache_status: parseDebridCacheStatus(stream),
    });
  }

  const scoreConfig = {
    max_quality: null,
    // Phase B is the last resort. Prefer 4K (fidelity-first), and the hardware
    // decode tiebreaker in streamPlayScore still floats a HW-decodable stream to
    // the top of a resolution tier — nothing is excluded.
    preferred_quality: '2160p' as QualityCap,
    preferred_hdr_tags: [] as string[],
    preferred_video_codecs: [] as string[],
  };

  kept.sort((left, right) => streamPlayScore(right, scoreConfig, undefined, {
    preferred_language: options.preferred_language,
  }) - streamPlayScore(left, scoreConfig, undefined, {
    preferred_language: options.preferred_language,
  }));

  return kept.slice(0, max).map((stream) => ({
    stream,
    ladder_step: OBLIGATION_FLOOR_STEP,
  }));
}

export function playObligationMaxAttempts(): number {
  const raw = process.env.MANGO_PLAY_OBLIGATION_MAX_ATTEMPTS;
  if (raw === undefined || raw === '') return 6;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

export type DisplayStreamSource = 'preference_ladder' | 'obligation_floor' | 'last_resort' | 'empty';

export type DisplayLadderOptions = {
  strict_unknown_cache?: boolean;
  hard_language?: string | null;
  preferred_language?: string | null;
  min_quality?: QualityCap | null;
  max_quality?: QualityCap | null;
  exclude_remux?: boolean;
  preferred_quality?: QualityCap | null;
  preferred_hdr_tags?: string[];
  preferred_video_codecs?: string[];
  max_candidates?: number;
  include_uncached?: boolean;
  /** When set, used instead of deriving main from legacy `ladder`. */
  main_ladder?: PlayLadderStep[];
  last_resort_ladder?: PlayLadderStep[];
};

/**
 * GET /stream picker: main ladder first; if empty, last-resort (+ obligation floor).
 * Last-resort / floor rows are marked unverified by the caller.
 */
export function selectDisplayStreamCandidates(
  streams: Stream[],
  ladder: PlayLadderStep[],
  context: StreamFilterContext = {},
  options: DisplayLadderOptions = {},
): { candidates: LadderCandidate[]; source: DisplayStreamSource } {
  const max = options.max_candidates ?? 12;
  const split = splitLegacyPlayLadder(ladder.length > 0 ? ladder : defaultPlayLadder());
  const main = options.main_ladder ?? split.main_ladder;
  const lastResort = options.last_resort_ladder ?? split.last_resort_ladder;

  const preference = expandPlayLadder(streams, main, context, {
    ...options,
    max_candidates: max,
  });
  if (preference.length > 0) {
    return { candidates: preference, source: 'preference_ladder' };
  }

  const resort = expandPlayLadder(streams, lastResort, context, {
    ...options,
    include_uncached: true,
    max_candidates: max,
  });
  if (resort.length > 0) {
    return { candidates: resort, source: 'last_resort' };
  }

  const floor = expandObligationFloor(streams, context, {
    maxCandidates: max,
    hard_language: options.hard_language,
    preferred_language: options.preferred_language,
    min_quality: options.min_quality,
    max_quality: options.max_quality,
    exclude_remux: options.exclude_remux,
  });
  if (floor.length > 0) {
    return { candidates: floor, source: 'obligation_floor' };
  }
  return { candidates: [], source: 'empty' };
}

/** Picker mode: exactly one candidate for the preferred URL (no ladder fallthrough). */
export function singlePickerCandidate(
  streams: Stream[],
  preferUrl: string,
  preferLadderStep?: string | null,
): LadderCandidate | null {
  if (!preferUrl || !/^https?:\/\//i.test(preferUrl)) {
    return null;
  }
  const hash = streamUrlHash(preferUrl);
  const match = streams.find((stream) => streamUrlHash(stream.url) === hash);
  if (!match) {
    return null;
  }
  const preferStep = typeof preferLadderStep === 'string' ? preferLadderStep.trim() : '';
  const fromMatch = typeof match.ladder_step === 'string' ? match.ladder_step.trim() : '';
  return {
    stream: match,
    ladder_step: preferStep || fromMatch || 'picker',
  };
}

/** Stable release fingerprint for picker bad-cache (prefer infoHash / bingeGroup over URL). */
export function streamReleaseFingerprint(stream: Stream): string {
  return streamStableIdentity(stream);
}

export function couchStatusForLadderStep(step: string): string {
  switch (step) {
    case 'ideal':
      return 'trying best match…';
    case '1080p_uncached':
      return 'preparing uncached fallback…';
    case '1080p_remux':
      return 'trying alternate 1080p release…';
    case '2160p_encode':
      return 'trying higher-quality encode…';
    case '2160p_hdr_cached':
      return 'trying 4K HDR-preferred stream…';
    case '2160p_cached':
      return 'trying alternate 4K stream…';
    case '4k_sdr_remux_cached':
      return 'starting 4K stream…';
    case '4k_sdr_cached':
      return 'trying alternate 4K encode…';
    case '1080p_hevc_cached':
      return 'trying 1080p HEVC stream…';
    case 'picker':
      return 'starting selected stream…';
    case '1080p_cached_fallback':
      return 'trying 1080p fallback…';
    case '1080p_uncached_fallback':
      return 'preparing uncached fallback…';
    case 'last_resort':
      return 'trying alternate release…';
    case OBLIGATION_FLOOR_STEP:
      return 'trying another source…';
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

import { CatalogError, type Stream } from './core.js';
import { playUrl, probeUrl, getMpvPlaybackState } from './mpv.js';
import { preflightPlaybackUrl } from './preflight-playback.js';
import {
  couchStatusForLadderStep,
  expandObligationFloor,
  expandPlayLadder,
  injectPreferredPlayCandidate,
  playObligationMaxAttempts,
  type LadderCandidate,
  type PlayLadderStep,
} from './play-ladder.js';
import { assertPlayEpoch, PlayCancelledError } from './play-cancel.js';
import {
  debridServiceId,
  parseDebridCacheStatus,
  streamMatchesVerifiedHint,
  streamUrlHash,
  type StreamFilterConfig,
  type VerifiedStreamHint,
  isPlausibleFeatureDuration,
} from './stream-filters.js';
import {
  isBadStreamError,
  isStreamUrlBad,
  markStreamUrlBad,
} from './stream-bad-cache.js';

export type PlayOrchestratorConfig = StreamFilterConfig & { include_uncached: boolean };

export type PlayAttempt = {
  index: number;
  url?: string;
  ladder_step?: string;
  source?: string;
  quality?: string;
  cache_status?: unknown;
  debrid_service?: unknown;
  ok: boolean;
  ms: number;
  probe_ms?: number;
  probe_reused?: boolean;
  ttff_ms?: number;
  error?: string;
};

export type PlayOrchestratorResult = {
  ok: true;
  ttff_ms: number;
  probe_ms: number;
  total_ms: number;
  attempts: PlayAttempt[];
  stream: Record<string, unknown>;
  candidate_count: number;
  win_ladder_step: string;
  win_url_hash: string;
  /** True when Phase B (obligation floor) ran after preference ladder exhaustion. */
  obligation_floor_ran?: boolean;
};

function streamMeta(stream: Stream, ladderStep: string): Record<string, unknown> {
  return {
    source: stream.source,
    title: stream.title,
    quality: stream.quality,
    cache_status: stream.cache_status,
    debrid_service: stream.debrid_service,
    ladder_step: ladderStep,
  };
}

function attemptBase(index: number, candidate: LadderCandidate): Omit<PlayAttempt, 'ok' | 'ms'> {
  return {
    index,
    url: candidate.stream.url,
    ladder_step: candidate.ladder_step,
    source: candidate.stream.source,
    quality: candidate.stream.quality,
    cache_status: candidate.stream.cache_status,
    debrid_service: candidate.stream.debrid_service,
  };
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/g, 'http(s)://<redacted>')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ') || 'playback failed';
}

function probeBudgetForCandidate(
  candidate: LadderCandidate,
  config: PlayOrchestratorConfig,
  remainingMs: number,
): number {
  const cache = parseDebridCacheStatus(candidate.stream);
  const base = cache === 'uncached' ? config.auto_play_uncached_probe_ms : config.auto_play_probe_ms;
  return Math.min(base, remainingMs);
}

function shouldSkipProbe(candidate: LadderCandidate): boolean {
  // Never skip probe for debrid VOD — copyright / status-clip / NFO must be
  // caught with vo=null before visible handoff. Uncached TorBox still probes
  // with the longer uncached budget.
  if (debridServiceId(candidate.stream)) {
    return false;
  }
  return candidate.ladder_step === '1080p_uncached'
    || candidate.ladder_step === '1080p_uncached_fallback'
    || parseDebridCacheStatus(candidate.stream) === 'uncached';
}

function rememberBadStream(url: string, error: unknown): void {
  const cleaned = typeof error === 'string' ? error : cleanError(error);
  if (isBadStreamError(cleaned)) {
    markStreamUrlBad(streamUrlHash(url));
  }
}

/** Reserve wall budget so Phase B obligation floor is not starved by Phase A. */
export function playObligationReserveMs(): number {
  const raw = process.env.MANGO_PLAY_OBLIGATION_MIN_MS;
  if (raw === undefined || raw === '') return 20_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 20_000;
  return Math.max(0, Math.min(60_000, Math.floor(parsed)));
}

const PREFLIGHT_BUDGET_CAP_MS = 8000;

async function assertPlausibleFeatureProbe(options: {
  contentType?: string;
  filterContext?: import('./stream-filters.js').StreamFilterContext;
}): Promise<void> {
  const playbackState = await getMpvPlaybackState();
  if (!playbackState || playbackState.duration_sec <= 0) {
    return;
  }
  const probedMinutes = playbackState.duration_sec / 60;
  if (!isPlausibleFeatureDuration(
    probedMinutes,
    options.contentType,
    options.filterContext?.metaRuntimeMinutes,
  )) {
    throw new Error('supplemental_or_short_release');
  }
}

/** Probe-only ladder walk — used by N3c verify (Phase 2). */
export async function probeWithLadder(
  streams: Stream[],
  config: PlayOrchestratorConfig,
  options: {
    ladder?: PlayLadderStep[];
    contentType?: string;
    filterContext?: import('./stream-filters.js').StreamFilterContext;
    verified_hint?: VerifiedStreamHint;
    playEpoch?: number;
    probe?: typeof probeUrl;
    preflight?: typeof preflightPlaybackUrl;
    max_candidates?: number;
    include_uncached?: boolean;
  } = {},
): Promise<{
  ok: true;
  stream: Stream;
  ladder_step: string;
  probe_ms: number;
  attempts: PlayAttempt[];
  candidate_count: number;
} | {
  ok: false;
  attempts: PlayAttempt[];
  candidate_count: number;
}> {
  const ladder = options.ladder ?? config.play_ladder;
  const probe = options.probe ?? probeUrl;
  const preflight = options.preflight ?? preflightPlaybackUrl;
  const candidates = expandPlayLadder(streams, ladder, options.filterContext ?? {
    contentType: options.contentType,
  }, {
    strict_unknown_cache: config.strict_unknown_cache,
    preferred_quality: config.preferred_quality,
    preferred_hdr_tags: config.preferred_hdr_tags,
    preferred_video_codecs: config.preferred_video_codecs,
    verified_hint: options.verified_hint,
    max_candidates: options.max_candidates ?? config.auto_play_max_attempts,
    include_uncached: options.include_uncached,
    prefer_ladder_step: options.verified_hint?.win_ladder_step ?? null,
  });
  const attempts: PlayAttempt[] = [];
  const wallMs = config.auto_play_wall_ms;
  const started = Date.now();
  const deadline = started + wallMs;

  for (const [index, candidate] of candidates.entries()) {
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    const urlHash = streamUrlHash(candidate.stream.url);
    if (isStreamUrlBad(urlHash)) {
      attempts.push({
        ...attemptBase(index, candidate),
        ok: false,
        ms: 0,
        error: 'stream_url_bad_cached',
      });
      continue;
    }
    const attemptStarted = Date.now();
    const base = attemptBase(index, candidate);
    try {
      const preflightBudget = Math.min(PREFLIGHT_BUDGET_CAP_MS, remaining);
      const sniff = await preflight(candidate.stream.url, preflightBudget);
      if (sniff === 'nfo') throw new Error('debrid_nfo_sidecar');
      // timeout → proceed to probe (transient debrid latency)
      if (sniff === 'error' && parseDebridCacheStatus(candidate.stream) === 'cached') {
        throw new Error('debrid_playback_unreadable');
      }
      const probeBudget = probeBudgetForCandidate(candidate, config, remaining);
      const probeResult = await probe(candidate.stream.url, probeBudget, undefined, options.playEpoch);
      await assertPlausibleFeatureProbe(options);
      attempts.push({
        ...base,
        ok: true,
        ms: Date.now() - attemptStarted,
        probe_ms: probeResult.ttff_ms,
      });
      return {
        ok: true,
        stream: candidate.stream,
        ladder_step: candidate.ladder_step,
        probe_ms: probeResult.ttff_ms,
        attempts,
        candidate_count: candidates.length,
      };
    } catch (error) {
      rememberBadStream(candidate.stream.url, error);
      attempts.push({
        ...base,
        ok: false,
        ms: Date.now() - attemptStarted,
        error: cleanError(error),
      });
    }
  }

  return { ok: false, attempts, candidate_count: candidates.length };
}

type AttemptLoopResult =
  | { kind: 'success'; result: PlayOrchestratorResult }
  | { kind: 'exhausted'; attempts: PlayAttempt[] };

async function attemptCandidates(options: {
  candidates: LadderCandidate[];
  config: PlayOrchestratorConfig;
  started: number;
  deadline: number;
  attemptOffset: number;
  contentType?: string;
  filterContext?: import('./stream-filters.js').StreamFilterContext;
  verified_hint?: VerifiedStreamHint;
  playEpoch?: number;
  probe: typeof probeUrl;
  play: typeof playUrl;
  preflight: typeof preflightPlaybackUrl;
  onLadderStep?: (step: string, label: string) => void;
  startSec?: number;
  minDurationSec: number;
  obligationFloorRan?: boolean;
}): Promise<AttemptLoopResult> {
  const attempts: PlayAttempt[] = [];
  let lastStep = '';

  for (const [relativeIndex, candidate] of options.candidates.entries()) {
    const index = options.attemptOffset + relativeIndex;
    if (candidate.ladder_step !== lastStep) {
      lastStep = candidate.ladder_step;
      options.onLadderStep?.(lastStep, couchStatusForLadderStep(lastStep));
    }
    if (options.playEpoch !== undefined) {
      await assertPlayEpoch(options.playEpoch);
    }
    const remainingBeforeProbe = options.deadline - Date.now();
    if (remainingBeforeProbe < 500) {
      break;
    }

    const attemptStarted = Date.now();
    const base = attemptBase(index, candidate);
    const urlHash = streamUrlHash(candidate.stream.url);
    if (isStreamUrlBad(urlHash)) {
      attempts.push({
        ...base,
        ok: false,
        ms: 0,
        error: 'stream_url_bad_cached',
      });
      continue;
    }
    const reusableProbeMs = streamMatchesVerifiedHint(candidate.stream, options.verified_hint)
      && options.verified_hint?.win_ladder_step === candidate.ladder_step
      && options.verified_hint?.probe_ms
      && options.verified_hint.probe_ms > 0
      && options.verified_hint.probe_ms <= options.config.auto_play_probe_ms
      ? options.verified_hint.probe_ms
      : undefined;
    try {
      let observedProbeMs = reusableProbeMs;
      let probeReused = false;
      const skipProbe = shouldSkipProbe(candidate);
      // The byte-sniff must always run for a fresh candidate URL, even when a
      // verified hint lets us reuse its probe timing — a matching hint proves
      // the *ladder step* played before, not that today's URL still serves
      // real video (e.g. TorBox can silently swap a cached slot to an .nfo
      // sidecar). Only the probe *measurement* is safe to skip on reuse.
      // Real-Debrid (and all debrid) never skip probe — see shouldSkipProbe.
      const preflightBudget = Math.min(PREFLIGHT_BUDGET_CAP_MS, remainingBeforeProbe);
      const sniff = await options.preflight(candidate.stream.url, preflightBudget);
      if (sniff === 'nfo') {
        throw new Error('debrid_nfo_sidecar');
      }
      // timeout → proceed to probe (transient debrid latency; do not bad-cache)
      if (sniff === 'error' && parseDebridCacheStatus(candidate.stream) === 'cached') {
        throw new Error('debrid_playback_unreadable');
      }
      if (!observedProbeMs) {
        if (!skipProbe) {
          const probeBudget = probeBudgetForCandidate(candidate, options.config, remainingBeforeProbe);
          const probeResult = await options.probe(
            candidate.stream.url,
            probeBudget,
            undefined,
            options.playEpoch,
            options.startSec,
          );
          observedProbeMs = probeResult.ttff_ms;
          if (options.playEpoch !== undefined) {
            await assertPlayEpoch(options.playEpoch);
          }
        } else {
          observedProbeMs = 0;
        }
      } else {
        probeReused = true;
      }
      if (!skipProbe) {
        await assertPlausibleFeatureProbe({
          contentType: options.contentType,
          filterContext: options.filterContext,
        });
      }
      const remainingBeforePlay = options.deadline - Date.now();
      if (remainingBeforePlay < 500) {
        throw new Error('play budget exhausted after probe');
      }
      const playback = await options.play(candidate.stream.url, remainingBeforePlay, {
        playEpoch: options.playEpoch,
        minDurationSec: options.minDurationSec,
        startSec: options.startSec,
        ladderStep: candidate.ladder_step,
      });
      const attempt: PlayAttempt = {
        ...base,
        ok: true,
        ms: Date.now() - attemptStarted,
        probe_ms: observedProbeMs,
        ...(probeReused ? { probe_reused: true } : {}),
        ttff_ms: playback.ttff_ms,
      };
      attempts.push(attempt);
      return {
        kind: 'success',
        result: {
          ok: true,
          ttff_ms: playback.ttff_ms,
          probe_ms: observedProbeMs ?? 0,
          total_ms: Date.now() - options.started,
          attempts,
          stream: streamMeta(candidate.stream, candidate.ladder_step),
          candidate_count: options.candidates.length,
          win_ladder_step: candidate.ladder_step,
          win_url_hash: streamUrlHash(candidate.stream.url),
          ...(options.obligationFloorRan ? { obligation_floor_ran: true } : {}),
        },
      };
    } catch (error) {
      if (error instanceof PlayCancelledError) {
        throw error;
      }
      rememberBadStream(candidate.stream.url, error);
      attempts.push({
        ...base,
        ok: false,
        ms: Date.now() - attemptStarted,
        error: cleanError(error),
      });
    }
  }

  return { kind: 'exhausted', attempts };
}

/**
 * Couch play: Phase A preference ladder, then Phase B obligation floor
 * (integrity-safe streams, any quality/cache) before returning no_playable_stream.
 */
export async function playWithLadder(
  streams: Stream[],
  config: PlayOrchestratorConfig,
  options: {
    ladder?: PlayLadderStep[];
    contentType?: string;
    filterContext?: import('./stream-filters.js').StreamFilterContext;
    verified_hint?: VerifiedStreamHint;
    playEpoch?: number;
    probe?: typeof probeUrl;
    play?: typeof playUrl;
    preflight?: typeof preflightPlaybackUrl;
    onLadderStep?: (step: string, label: string) => void;
    startSec?: number;
    preferUrl?: string;
  } = {},
): Promise<PlayOrchestratorResult> {
  const started = Date.now();
  const wallMs = config.auto_play_wall_ms;
  const probe = options.probe ?? probeUrl;
  const play = options.play ?? playUrl;
  const preflight = options.preflight ?? preflightPlaybackUrl;
  const ladder = options.ladder ?? config.play_ladder;
  const deadline = started + wallMs;
  const obligationReserve = playObligationReserveMs();
  const phaseADeadline = Math.max(
    started + 500,
    deadline - obligationReserve,
  );
  const preferLadderStep = options.verified_hint?.win_ladder_step ?? null;
  const filterContext = options.filterContext ?? { contentType: options.contentType };
  const phaseA = injectPreferredPlayCandidate(
    streams,
    expandPlayLadder(streams, ladder, filterContext, {
      strict_unknown_cache: config.strict_unknown_cache,
      preferred_quality: config.preferred_quality,
      preferred_hdr_tags: config.preferred_hdr_tags,
      preferred_video_codecs: config.preferred_video_codecs,
      verified_hint: options.verified_hint,
      max_candidates: config.auto_play_max_attempts,
      prefer_ladder_step: preferLadderStep,
    }),
    options.preferUrl,
    preferLadderStep,
  );
  const minDurationSec = options.contentType === 'series' ? 600 : 600;
  const shared = {
    config,
    started,
    deadline,
    contentType: options.contentType,
    filterContext,
    verified_hint: options.verified_hint,
    playEpoch: options.playEpoch,
    probe,
    play,
    preflight,
    onLadderStep: options.onLadderStep,
    startSec: options.startSec,
    minDurationSec,
  };

  const allAttempts: PlayAttempt[] = [];
  let obligationFloorRan = false;
  let totalCandidates = phaseA.length;

  if (phaseA.length > 0) {
    const phaseAResult = await attemptCandidates({
      ...shared,
      deadline: phaseADeadline,
      candidates: phaseA,
      attemptOffset: 0,
    });
    if (phaseAResult.kind === 'success') {
      return {
        ...phaseAResult.result,
        attempts: phaseAResult.result.attempts,
        candidate_count: phaseA.length,
      };
    }
    allAttempts.push(...phaseAResult.attempts);
  }

  const remainingMs = deadline - Date.now();
  if (remainingMs >= 500) {
    // Exclude only URLs actually attempted in Phase A — unattempted Phase A
    // candidates (wall/order starved) stay eligible for the obligation floor.
    const excludeUrls = new Set(
      allAttempts.map((attempt) => attempt.url).filter((url): url is string => Boolean(url)),
    );
    const phaseB = expandObligationFloor(streams, filterContext, {
      excludeUrls,
      maxCandidates: playObligationMaxAttempts(),
    });
    if (phaseB.length > 0) {
      obligationFloorRan = true;
      totalCandidates += phaseB.length;
      const phaseBResult = await attemptCandidates({
        ...shared,
        candidates: phaseB,
        attemptOffset: allAttempts.length,
        obligationFloorRan: true,
      });
      if (phaseBResult.kind === 'success') {
        return {
          ...phaseBResult.result,
          attempts: [...allAttempts, ...phaseBResult.result.attempts],
          candidate_count: totalCandidates,
          obligation_floor_ran: true,
        };
      }
      allAttempts.push(...phaseBResult.attempts);
    }
  }

  throw new CatalogError(502, 'no_playable_stream', {
    attempts: allAttempts,
    total_ms: Date.now() - started,
    candidates: totalCandidates,
    obligation_floor_ran: obligationFloorRan,
  });
}

/** @deprecated Use playWithLadder — kept for unit tests migrating off legacy API. */
export const playWithFallback = playWithLadder;

export { couchStatusForLadderStep };

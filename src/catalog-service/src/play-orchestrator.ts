import { CatalogError, type Stream } from './core.js';
import { playUrl, probeUrl, getMpvPlaybackState } from './mpv.js';
import { preflightPlaybackUrl } from './preflight-playback.js';
import {
  couchStatusForLadderStep,
  expandPlayLadder,
  type LadderCandidate,
  type PlayLadderStep,
} from './play-ladder.js';
import { assertPlayEpoch, PlayCancelledError } from './play-cancel.js';
import {
  parseDebridCacheStatus,
  streamMatchesVerifiedHint,
  streamUrlHash,
  type StreamFilterConfig,
  type VerifiedStreamHint,
  isPlausibleFeatureDuration,
} from './stream-filters.js';

export type PlayOrchestratorConfig = StreamFilterConfig & { include_uncached: boolean };

export type PlayAttempt = {
  index: number;
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
  total_ms: number;
  attempts: PlayAttempt[];
  stream: Record<string, unknown>;
  candidate_count: number;
  win_ladder_step: string;
  win_url_hash: string;
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
  return candidate.ladder_step === '1080p_uncached'
    || parseDebridCacheStatus(candidate.stream) === 'uncached';
}

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
    const attemptStarted = Date.now();
    const base = attemptBase(index, candidate);
    try {
      const preflightBudget = Math.min(2500, remaining);
      const sniff = await preflight(candidate.stream.url, preflightBudget);
      if (sniff === 'nfo') throw new Error('debrid_nfo_sidecar');
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
  } = {},
): Promise<PlayOrchestratorResult> {
  const started = Date.now();
  const wallMs = config.auto_play_wall_ms;
  const probe = options.probe ?? probeUrl;
  const play = options.play ?? playUrl;
  const preflight = options.preflight ?? preflightPlaybackUrl;
  const ladder = options.ladder ?? config.play_ladder;
  const deadline = started + wallMs;
  const candidates = expandPlayLadder(streams, ladder, options.filterContext ?? {
    contentType: options.contentType,
  }, {
    strict_unknown_cache: config.strict_unknown_cache,
    preferred_quality: config.preferred_quality,
    preferred_hdr_tags: config.preferred_hdr_tags,
    verified_hint: options.verified_hint,
    max_candidates: config.auto_play_max_attempts,
    prefer_ladder_step: options.verified_hint?.win_ladder_step ?? null,
  });
  const minDurationSec = options.contentType === 'series' ? 600 : 600;
  const attempts: PlayAttempt[] = [];
  let lastStep = '';

  if (candidates.length === 0) {
    throw new CatalogError(502, 'no_playable_stream', {
      attempts,
      total_ms: Date.now() - started,
      candidates: 0,
    });
  }

  for (const [index, candidate] of candidates.entries()) {
    if (candidate.ladder_step !== lastStep) {
      lastStep = candidate.ladder_step;
      options.onLadderStep?.(lastStep, couchStatusForLadderStep(lastStep));
    }
    if (options.playEpoch !== undefined) {
      await assertPlayEpoch(options.playEpoch);
    }
    const remainingBeforeProbe = deadline - Date.now();
    if (remainingBeforeProbe < 500) {
      break;
    }

    const attemptStarted = Date.now();
    const base = attemptBase(index, candidate);
    const reusableProbeMs = streamMatchesVerifiedHint(candidate.stream, options.verified_hint)
      && options.verified_hint?.win_ladder_step === candidate.ladder_step
      && options.verified_hint?.probe_ms
      && options.verified_hint.probe_ms > 0
      && options.verified_hint.probe_ms <= config.auto_play_probe_ms
      ? options.verified_hint.probe_ms
      : undefined;
    try {
      let observedProbeMs = reusableProbeMs;
      let probeReused = false;
      const skipProbe = shouldSkipProbe(candidate);
      if (!observedProbeMs) {
        const preflightBudget = Math.min(2500, remainingBeforeProbe);
        const sniff = await preflight(candidate.stream.url, preflightBudget);
        if (sniff === 'nfo') {
          throw new Error('debrid_nfo_sidecar');
        }
        if (sniff === 'error' && parseDebridCacheStatus(candidate.stream) === 'cached') {
          throw new Error('debrid_playback_unreadable');
        }
        if (!skipProbe) {
          const probeBudget = probeBudgetForCandidate(candidate, config, remainingBeforeProbe);
          const probeResult = await probe(candidate.stream.url, probeBudget, undefined, options.playEpoch);
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
        await assertPlausibleFeatureProbe(options);
      }
      const remainingBeforePlay = deadline - Date.now();
      if (remainingBeforePlay < 500) {
        throw new Error('play budget exhausted after probe');
      }
      const playback = await play(candidate.stream.url, remainingBeforePlay, {
        playEpoch: options.playEpoch,
        minDurationSec,
        startSec: options.startSec,
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
        ok: true,
        ttff_ms: playback.ttff_ms,
        total_ms: Date.now() - started,
        attempts,
        stream: streamMeta(candidate.stream, candidate.ladder_step),
        candidate_count: candidates.length,
        win_ladder_step: candidate.ladder_step,
        win_url_hash: streamUrlHash(candidate.stream.url),
      };
    } catch (error) {
      if (error instanceof PlayCancelledError) {
        throw error;
      }
      attempts.push({
        ...base,
        ok: false,
        ms: Date.now() - attemptStarted,
        error: cleanError(error),
      });
    }
  }

  throw new CatalogError(502, 'no_playable_stream', {
    attempts,
    total_ms: Date.now() - started,
    candidates: candidates.length,
  });
}

/** @deprecated Use playWithLadder — kept for unit tests migrating off legacy API. */
export const playWithFallback = playWithLadder;

export { couchStatusForLadderStep };

import { CatalogError, type Stream } from './core.js';
import {
  playUrl,
  probeUrl,
  type PlaybackHudContext,
  type PlayResult,
} from './mpv.js';
import { preflightPlaybackUrl } from './preflight-playback.js';
import {
  couchStatusForLadderStep,
  expandObligationFloor,
  expandPlayLadder,
  isMainLadderStep,
  singlePickerCandidate,
  splitLegacyPlayLadder,
  streamReleaseFingerprint,
  type LadderCandidate,
  type PlayLadderStep,
} from './play-ladder.js';
import { emitPlaybackTelemetry } from './playback-telemetry.js';
import { assertPlayEpoch, PlayCancelledError } from './play-cancel.js';
import {
  debridServiceId,
  parseDebridCacheStatus,
  streamUrlHash,
  type StreamFilterConfig,
  type VerifiedStreamHint,
  isPlausibleFeatureDuration,
  playMinDurationSec,
} from './stream-filters.js';
import {
  classifyPlayError,
  isPipelineFatalPlayError,
  isTransientPlayError,
} from './play-error-classify.js';
import {
  isBadStreamError,
  isStreamUrlBad,
  markStreamUrlBad,
} from './stream-bad-cache.js';
import {
  classifyStreamCapability,
  type StreamTechnicalProfile,
} from './playback-capability.js';
import { upsertStreamPathEvidence } from './playability/db.js';

export type PlayOrchestratorConfig = StreamFilterConfig & {
  include_uncached: boolean;
  hard_language?: string | null;
  preferred_language?: string | null;
  min_quality?: import('./stream-filters.js').QualityCap | null;
  request_overrides?: import('./stream-filters.js').StreamFilterOverrides;
};

/** Couch play entry modes — candidate set + post-success policy differ. */
export type PlayMode = 'auto' | 'picker' | 'verify';

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
  /** True when win step is on main_ladder (eligible for verified library write). */
  win_on_main: boolean;
  /** True when Phase B (obligation floor) ran after preference ladder exhaustion. */
  obligation_floor_ran?: boolean;
  /** Picker mode: fingerprint to hide on failure. */
  picker_fingerprint?: string;
  technical?: StreamTechnicalProfile;
};

function streamMeta(stream: Stream, ladderStep: string): Record<string, unknown> {
  const decision = classifyStreamCapability(stream, {
    fingerprint: streamReleaseFingerprint(stream),
  });
  return {
    source: stream.source,
    title: stream.title,
    quality: stream.quality,
    cache_status: stream.cache_status,
    debrid_service: stream.debrid_service,
    ladder_step: ladderStep,
    capability_class: decision.capability_class,
    capability_reason: decision.reason,
    playback_profile_id: decision.profile_id,
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

function rememberBadStream(stream: Stream, error: unknown): void {
  const cleaned = typeof error === 'string' ? error : cleanError(error);
  if (isBadStreamError(cleaned)) {
    markStreamUrlBad(streamReleaseFingerprint(stream));
    markStreamUrlBad(streamUrlHash(stream.url));
  }
}

function candidateIsBad(candidate: LadderCandidate): boolean {
  if (isStreamUrlBad(streamUrlHash(candidate.stream.url))) return true;
  return isStreamUrlBad(streamReleaseFingerprint(candidate.stream));
}

/** Extra Phase B window when obligation candidates exist after the main wall. */
export function playPhaseBExtensionMs(): number {
  const raw = process.env.MANGO_PLAY_PHASE_B_EXTENSION_MS;
  if (raw === undefined || raw === '') return 30_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.max(0, Math.min(60_000, Math.floor(parsed)));
}

const PREFLIGHT_BUDGET_CAP_MS = 8000;

function assertPlausibleFeatureProbe(result: PlayResult, options: {
  contentType?: string;
  filterContext?: import('./stream-filters.js').StreamFilterContext;
}): void {
  if (result.duration_sec === undefined || result.duration_sec <= 0) {
    return;
  }
  const probedMinutes = result.duration_sec / 60;
  if (!isPlausibleFeatureDuration(
    probedMinutes,
    options.contentType,
    options.filterContext?.metaRuntimeMinutes,
    { episodeRole: options.filterContext?.episodeRole },
  )) {
    throw new Error('supplemental_or_short_release');
  }
}

type AttemptOneMode = 'play' | 'probe';

type AttemptOneOptions = {
  mode: AttemptOneMode;
  candidate: LadderCandidate;
  index: number;
  config: PlayOrchestratorConfig;
  deadline: number;
  /** Wall-clock start of the overall play/probe walk — used for total_ms on play success. */
  started: number;
  contentType?: string;
  filterContext?: import('./stream-filters.js').StreamFilterContext;
  verified_hint?: VerifiedStreamHint;
  playEpoch?: number;
  probe: typeof probeUrl;
  play?: typeof playUrl;
  preflight: typeof preflightPlaybackUrl;
  startSec?: number;
  hud?: PlaybackHudContext;
  minDurationSec?: number;
  obligationFloorRan?: boolean;
  candidateCount: number;
  /** When true: skip preflight, skip hint reuse, always probe (thin retry path). */
  retryPass?: boolean;
  /** Structured proof from a prior pass through this attempt loop. */
  reuseProbe?: PlayResult;
  deferKnownRiskAfterProbe?: boolean;
};

type AttemptOneResult =
  | { kind: 'success'; result: PlayOrchestratorResult }
  | { kind: 'probe_ok'; stream: Stream; ladder_step: string; probe_ms: number; attempt: PlayAttempt }
  | { kind: 'deferred_risky'; candidate: LadderCandidate; probe: PlayResult; attempt: PlayAttempt }
  | { kind: 'failure'; attempt: PlayAttempt; error: string };

/**
 * Single probe→(play) unit shared by the main attempt loop, last-candidate
 * thin retry, and probeWithLadder. Bad-cache skip and thin-retry control stay
 * in the caller.
 */
async function attemptOne(options: AttemptOneOptions): Promise<AttemptOneResult> {
  const { candidate, index, config, deadline, retryPass = false } = options;
  const attemptStarted = Date.now();
  const base = attemptBase(index, candidate);
  const remainingAtStart = deadline - Date.now();

  try {
    if (options.playEpoch !== undefined) {
      await assertPlayEpoch(options.playEpoch);
    }

    // Verified hints rank candidates but never replace a fresh safety probe:
    // signed URLs can rotate to status clips while retaining release identity.
    let observedProbeMs: number | undefined;
    let structuredProbeResult: PlayResult | undefined = options.reuseProbe;
    let skipProbe = false;
    if (options.mode === 'play' && !retryPass) {
      skipProbe = shouldSkipProbe(candidate);
    }

    // Preflight always runs for normal play and probe mode; never on thin retry.
    // The byte-sniff must always run for a fresh candidate URL, even when a
    // verified hint lets us reuse its probe timing — a matching hint proves
    // the *ladder step* played before, not that today's URL still serves
    // real video (e.g. TorBox can silently swap a cached slot to an .nfo
    // sidecar). Only the probe *measurement* is safe to skip on reuse.
    if (!retryPass && !options.reuseProbe) {
      const preflightBudget = Math.min(PREFLIGHT_BUDGET_CAP_MS, remainingAtStart);
      const sniff = await options.preflight(candidate.stream.url, preflightBudget);
      if (sniff === 'nfo') {
        throw new Error('debrid_nfo_sidecar');
      }
      // timeout / error / unknown → proceed to mpv probe (sniff is NFO-only gate)
    }

    const alwaysProbe = retryPass || options.mode === 'probe';
    if (options.reuseProbe) {
      observedProbeMs = options.reuseProbe.ttff_ms;
      skipProbe = true;
    } else if (alwaysProbe) {
      const probeBudget = probeBudgetForCandidate(candidate, config, deadline - Date.now());
      const probeResult = await options.probe(
        candidate.stream.url,
        probeBudget,
        undefined,
        options.playEpoch,
        options.mode === 'play' ? options.startSec : undefined,
        options.mode === 'play' ? 'user' : 'background',
      );
      structuredProbeResult = probeResult;
      observedProbeMs = probeResult.ttff_ms;
      if (options.mode === 'play' && options.playEpoch !== undefined) {
        await assertPlayEpoch(options.playEpoch);
      }
      assertPlausibleFeatureProbe(probeResult, {
        contentType: options.contentType,
        filterContext: options.filterContext,
      });
    } else if (!skipProbe) {
      const probeBudget = probeBudgetForCandidate(candidate, config, remainingAtStart);
      const probeResult = await options.probe(
        candidate.stream.url,
        probeBudget,
        undefined,
        options.playEpoch,
        options.startSec,
        options.mode === 'play' ? 'user' : 'background',
      );
      structuredProbeResult = probeResult;
      observedProbeMs = probeResult.ttff_ms;
      if (options.playEpoch !== undefined) {
        await assertPlayEpoch(options.playEpoch);
      }
    } else {
      observedProbeMs = 0;
    }

    if (structuredProbeResult?.technical) {
      const fingerprint = streamReleaseFingerprint(candidate.stream);
      const decision = classifyStreamCapability(candidate.stream, {
        technical: structuredProbeResult.technical,
        fingerprint,
      });
      try {
        upsertStreamPathEvidence({
          release_fingerprint: fingerprint,
          profile_id: decision.profile_id,
          capability_class: decision.capability_class,
          technical: structuredProbeResult.technical,
          reason: decision.reason,
          last_proof_at: Date.now(),
        });
      } catch {
        // Operator evidence improves future ranking but must never turn a
        // successful stream probe into a couch playback failure.
      }
      if (
        options.mode === 'play'
        && options.deferKnownRiskAfterProbe !== false
        && candidate.capability_class !== 'known_risky'
        && decision.capability_class === 'known_risky'
      ) {
        return {
          kind: 'deferred_risky',
          candidate: {
            ...candidate,
            capability_class: 'known_risky',
            capability_reason: decision.reason,
            playback_profile_id: decision.profile_id,
            technical: structuredProbeResult.technical,
          },
          probe: structuredProbeResult,
          attempt: {
            ...base,
            ok: false,
            ms: Date.now() - attemptStarted,
            probe_ms: observedProbeMs,
            error: 'deferred_known_risky_after_probe',
          },
        };
      }
    }

    if (!alwaysProbe && !skipProbe) {
      assertPlausibleFeatureProbe(structuredProbeResult ?? { ok: true, ttff_ms: observedProbeMs ?? 0 }, {
        contentType: options.contentType,
        filterContext: options.filterContext,
      });
    }

    if (options.mode === 'probe') {
      const attempt: PlayAttempt = {
        ...base,
        ok: true,
        ms: Date.now() - attemptStarted,
        probe_ms: observedProbeMs,
      };
      emitPlaybackTelemetry('ladder_attempt', {
        epoch: options.playEpoch,
        resolve_request_class: 'background',
        ladder_step: candidate.ladder_step,
        result_class: 'success',
        attempt_ms: attempt.ms,
      });
      return {
        kind: 'probe_ok',
        stream: candidate.stream,
        ladder_step: candidate.ladder_step,
        probe_ms: observedProbeMs ?? 0,
        attempt,
      };
    }

    const remainingBeforePlay = deadline - Date.now();
    if (remainingBeforePlay < 500) {
      throw new Error('play budget exhausted after probe');
    }
    const play = options.play;
    if (!play) {
      throw new Error('play function required for play mode');
    }
    const playback = await play(candidate.stream.url, remainingBeforePlay, {
      playEpoch: options.playEpoch,
      minDurationSec: options.minDurationSec ?? 600,
      startSec: options.startSec,
      ladderStep: candidate.ladder_step,
      hud: options.hud,
      knownTechnical: structuredProbeResult?.technical,
    });
    if (options.playEpoch !== undefined) {
      await assertPlayEpoch(options.playEpoch);
    }
    const attempt: PlayAttempt = {
      ...base,
      ok: true,
      ms: Date.now() - attemptStarted,
      probe_ms: observedProbeMs,
      ttff_ms: playback.ttff_ms,
    };
    emitPlaybackTelemetry('ladder_attempt', {
      epoch: options.playEpoch,
      resolve_request_class: 'user',
      ladder_step: candidate.ladder_step,
      result_class: 'success',
      attempt_ms: attempt.ms,
    });
    return {
      kind: 'success',
      result: {
        ok: true,
        ttff_ms: playback.ttff_ms,
        probe_ms: observedProbeMs ?? 0,
        total_ms: Date.now() - options.started,
        attempts: [attempt],
        stream: streamMeta(candidate.stream, candidate.ladder_step),
        candidate_count: options.candidateCount,
        win_ladder_step: candidate.ladder_step,
        win_url_hash: streamReleaseFingerprint(candidate.stream),
        win_on_main: false,
        ...(structuredProbeResult?.technical
          ? { technical: structuredProbeResult.technical }
          : {}),
        ...(options.obligationFloorRan ? { obligation_floor_ran: true } : {}),
      },
    };
  } catch (error) {
    if (error instanceof PlayCancelledError) {
      throw error;
    }
    const cleaned = cleanError(error);
    emitPlaybackTelemetry('ladder_attempt', {
      epoch: options.playEpoch,
      resolve_request_class: options.mode === 'play' ? 'user' : 'background',
      ladder_step: candidate.ladder_step,
      result_class: classifyPlayError(cleaned),
      attempt_ms: Date.now() - attemptStarted,
    });
    return {
      kind: 'failure',
      attempt: {
        ...base,
        ok: false,
        ms: Date.now() - attemptStarted,
        error: cleaned,
      },
      error: cleaned,
    };
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
    deadlineAtMs?: number;
    startedAtMs?: number;
    /** Pre-expanded candidates from prepareVerifyTitle; avoids identical work. */
    candidates?: LadderCandidate[];
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
  const ladder = options.ladder ?? config.main_ladder ?? config.play_ladder;
  const probe = options.probe ?? probeUrl;
  const preflight = options.preflight ?? preflightPlaybackUrl;
  const candidates = options.candidates ?? expandPlayLadder(streams, ladder, options.filterContext ?? {
    contentType: options.contentType,
  }, {
    strict_unknown_cache: config.strict_unknown_cache,
    preferred_quality: config.preferred_quality,
    preferred_hdr_tags: config.preferred_hdr_tags,
    preferred_video_codecs: config.preferred_video_codecs,
    verified_hint: options.verified_hint,
    max_candidates: options.max_candidates ?? config.auto_play_max_attempts,
    include_uncached: options.include_uncached,
    hard_language: config.hard_language,
    preferred_language: config.preferred_language,
    min_quality: config.request_overrides?.min_quality,
    max_quality: config.request_overrides?.max_quality,
    exclude_remux: config.request_overrides?.exclude_remux,
    prefer_ladder_step: options.verified_hint?.win_ladder_step ?? null,
  });
  const attempts: PlayAttempt[] = [];
  const wallMs = config.auto_play_wall_ms;
  const started = options.startedAtMs ?? Date.now();
  const deadline = Math.min(options.deadlineAtMs ?? Number.POSITIVE_INFINITY, started + wallMs);

  for (const [index, candidate] of candidates.entries()) {
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    if (candidateIsBad(candidate)) {
      attempts.push({
        ...attemptBase(index, candidate),
        ok: false,
        ms: 0,
        error: 'stream_url_bad_cached',
      });
      continue;
    }
    const one = await attemptOne({
      mode: 'probe',
      candidate,
      index,
      config,
      deadline,
      started,
      contentType: options.contentType,
      filterContext: options.filterContext,
      playEpoch: options.playEpoch,
      probe,
      preflight,
      candidateCount: candidates.length,
    });
    if (one.kind === 'probe_ok') {
      attempts.push(one.attempt);
      return {
        ok: true,
        stream: one.stream,
        ladder_step: one.ladder_step,
        probe_ms: one.probe_ms,
        attempts,
        candidate_count: candidates.length,
      };
    }
    if (one.kind === 'failure') {
      if (isPipelineFatalPlayError(one.error)) {
        throw pipelineFatalError(one.error, [...attempts, one.attempt]);
      }
      rememberBadStream(candidate.stream, one.error);
      attempts.push(one.attempt);
    }
  }

  return { ok: false, attempts, candidate_count: candidates.length };
}

type AttemptLoopResult =
  | { kind: 'success'; result: PlayOrchestratorResult }
  | { kind: 'fatal'; attempts: PlayAttempt[]; error: string }
  | { kind: 'exhausted'; attempts: PlayAttempt[]; deferred_risky: LadderCandidate[] };

type AttemptBudget = {
  limit: number;
  used: number;
};

function reserveAttempt(budget?: AttemptBudget): boolean {
  if (!budget) return true;
  if (budget.used >= budget.limit) return false;
  budget.used += 1;
  return true;
}

function pipelineFatalError(error: string, attempts: PlayAttempt[]): CatalogError {
  return new CatalogError(503, 'playback_pipeline_failed', {
    attempts,
    error,
  }, {
    couchMessage: 'could not start playback — try again',
  });
}

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
  /** When set, any failure bad-caches this fingerprint (picker hard-fail). */
  pickerFingerprint?: string;
  deferKnownRiskAfterProbe?: boolean;
  attemptBudget?: AttemptBudget;
}): Promise<AttemptLoopResult> {
  const attempts: PlayAttempt[] = [];
  const deferredRisky: LadderCandidate[] = [];
  let lastStep = '';

  for (const candidate of options.candidates) {
    if (
      options.deferKnownRiskAfterProbe !== false
      && candidate.capability_class === 'known_risky'
    ) {
      deferredRisky.push(candidate);
      continue;
    }
    const remainingBeforeProbe = options.deadline - Date.now();
    if (remainingBeforeProbe < 500) {
      break;
    }
    const index = options.attemptOffset + attempts.length;
    if (candidateIsBad(candidate)) {
      attempts.push({
        ...attemptBase(index, candidate),
        ok: false,
        ms: 0,
        error: 'stream_url_bad_cached',
      });
      continue;
    }
    if (!reserveAttempt(options.attemptBudget)) {
      break;
    }
    if (candidate.ladder_step !== lastStep) {
      lastStep = candidate.ladder_step;
      options.onLadderStep?.(lastStep, couchStatusForLadderStep(lastStep));
    }

    const sharedOne = {
      mode: 'play' as const,
      candidate,
      index,
      config: options.config,
      deadline: options.deadline,
      started: options.started,
      contentType: options.contentType,
      filterContext: options.filterContext,
      verified_hint: options.verified_hint,
      playEpoch: options.playEpoch,
      probe: options.probe,
      play: options.play,
      preflight: options.preflight,
      startSec: options.startSec,
      minDurationSec: options.minDurationSec,
      obligationFloorRan: options.obligationFloorRan,
      candidateCount: options.candidates.length,
      reuseProbe: candidate.probe_reuse,
      deferKnownRiskAfterProbe: options.deferKnownRiskAfterProbe,
    };

    const one = await attemptOne(sharedOne);
    if (one.kind === 'success') {
      return {
        kind: 'success',
        result: {
          ...one.result,
          attempts: [...attempts, ...one.result.attempts],
        },
      };
    }
    if (one.kind === 'deferred_risky') {
      attempts.push(one.attempt);
      deferredRisky.push({
        ...one.candidate,
        probe_reuse: one.probe,
      });
      continue;
    }
    if (one.kind !== 'failure') {
      continue;
    }

    const cleaned = one.error;
    if (isPipelineFatalPlayError(cleaned)) {
      return {
        kind: 'fatal',
        attempts: [...attempts, one.attempt],
        error: cleaned,
      };
    }
    const isLast = candidate === options.candidates[options.candidates.length - 1];
    const remainingForRetry = options.deadline - Date.now();
    // Thin titles: one transient retry on the last candidate without bad-cache.
    if (
      isLast
      && isTransientPlayError(cleaned)
      && remainingForRetry > 1500
      && !candidateIsBad(candidate)
      && reserveAttempt(options.attemptBudget)
    ) {
      attempts.push(one.attempt);
      const retry = await attemptOne({ ...sharedOne, retryPass: true });
      if (retry.kind === 'success') {
        return {
          kind: 'success',
          result: {
            ...retry.result,
            attempts: [...attempts, ...retry.result.attempts],
          },
        };
      }
      if (retry.kind === 'failure') {
        if (isPipelineFatalPlayError(retry.error)) {
          return {
            kind: 'fatal',
            attempts: [...attempts, retry.attempt],
            error: retry.error,
          };
        }
        rememberBadStream(candidate.stream, retry.error);
        attempts.push(retry.attempt);
      }
      continue;
    }

    rememberBadStream(candidate.stream, cleaned);
    attempts.push(one.attempt);
  }

  return {
    kind: 'exhausted',
    attempts,
    deferred_risky: deferredRisky,
  };
}

/**
 * Couch play modes:
 * - auto: main_ladder then last_resort_ladder (+ obligation floor)
 * - picker: exactly one preferred stream (no fallthrough)
 * - verify: main_ladder only (via probeWithLadder)
 */
export async function playWithLadder(
  streams: Stream[],
  config: PlayOrchestratorConfig,
  options: {
    mode?: PlayMode;
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
    hud?: PlaybackHudContext;
    preferUrl?: string;
    preferLadderStep?: string;
    deadlineAtMs?: number;
    startedAtMs?: number;
  } = {},
): Promise<PlayOrchestratorResult> {
  const started = options.startedAtMs ?? Date.now();
  const wallMs = config.auto_play_wall_ms;
  const probe = options.probe ?? probeUrl;
  const play = options.play ?? playUrl;
  const preflight = options.preflight ?? preflightPlaybackUrl;
  const mode: PlayMode = options.mode
    ?? (options.preferUrl ? 'picker' : 'auto');
  const mainLadder = config.main_ladder ?? config.play_ladder;
  const lastResortLadder = config.last_resort_ladder ?? [];
  const wallDeadline = Math.min(options.deadlineAtMs ?? Number.POSITIVE_INFINITY, started + wallMs);
  const deadline = wallDeadline;
  const mainDeadline = wallDeadline;
  let phaseBDeadline = wallDeadline;
  let phaseBExtended = false;
  const extendPhaseBIfNeeded = (hasCandidates: boolean): number => {
    if (!hasCandidates) return phaseBDeadline;
    if (!phaseBExtended) {
      phaseBExtended = true;
      phaseBDeadline = Math.min(
        wallDeadline + playPhaseBExtensionMs(),
        options.deadlineAtMs ?? Number.POSITIVE_INFINITY,
      );
    }
    return phaseBDeadline;
  };
  const preferLadderStep = options.preferLadderStep
    ?? options.verified_hint?.win_ladder_step
    ?? null;
  const filterContext = options.filterContext ?? { contentType: options.contentType };
  const minDurationSec = playMinDurationSec({
    contentType: options.contentType ?? filterContext.contentType,
    episodeRole: filterContext.episodeRole,
  });
  const shared = {
    config,
    started,
    contentType: options.contentType,
    filterContext,
    verified_hint: options.verified_hint,
    playEpoch: options.playEpoch,
    probe,
    play,
    preflight,
    onLadderStep: options.onLadderStep,
    startSec: options.startSec,
    hud: options.hud,
    minDurationSec,
  };

  const annotate = (result: PlayOrchestratorResult): PlayOrchestratorResult => ({
    ...result,
    win_on_main: isMainLadderStep(result.win_ladder_step, mainLadder),
  });

  // --- picker: single stream only ---
  if (mode === 'picker') {
    const picked = singlePickerCandidate(streams, options.preferUrl || '', preferLadderStep);
    if (!picked) {
      throw new CatalogError(502, 'no_playable_stream', {
        attempts: [],
        total_ms: Date.now() - started,
        candidates: 0,
      });
    }
    const fingerprint = streamReleaseFingerprint(picked.stream);
    if (candidateIsBad(picked)) {
      throw new CatalogError(502, 'no_playable_stream', {
        attempts: [{
          ...attemptBase(0, picked),
          ok: false,
          ms: 0,
          error: 'stream_url_bad_cached',
        }],
        total_ms: Date.now() - started,
        candidates: 1,
        picker_fingerprint: fingerprint,
      });
    }
    const pickerResult = await attemptCandidates({
      ...shared,
      deadline,
      candidates: [picked],
      attemptOffset: 0,
      pickerFingerprint: fingerprint,
      deferKnownRiskAfterProbe: false,
    });
    if (pickerResult.kind === 'success') {
      return annotate({
        ...pickerResult.result,
        candidate_count: 1,
        picker_fingerprint: fingerprint,
      });
    }
    if (pickerResult.kind === 'fatal') {
      throw pipelineFatalError(pickerResult.error, pickerResult.attempts);
    }
    throw new CatalogError(502, 'no_playable_stream', {
      attempts: pickerResult.attempts,
      total_ms: Date.now() - started,
      candidates: 1,
      picker_fingerprint: fingerprint,
    });
  }

  // --- auto: main then last-resort (+ obligation floor) ---
  const split = options.ladder
    ? (() => {
      const { main_ladder, last_resort_ladder } = splitLegacyPlayLadder(options.ladder);
      return { main: main_ladder, resort: last_resort_ladder };
    })()
    : { main: mainLadder, resort: lastResortLadder };

  const phaseMain = expandPlayLadder(streams, split.main, filterContext, {
    strict_unknown_cache: config.strict_unknown_cache,
    preferred_quality: config.preferred_quality,
    preferred_hdr_tags: config.preferred_hdr_tags,
    preferred_video_codecs: config.preferred_video_codecs,
    verified_hint: options.verified_hint,
    max_candidates: Number.MAX_SAFE_INTEGER,
    prefer_ladder_step: preferLadderStep,
    hard_language: config.hard_language,
    preferred_language: config.preferred_language,
    min_quality: config.request_overrides?.min_quality,
    max_quality: config.request_overrides?.max_quality,
    exclude_remux: config.request_overrides?.exclude_remux,
  });

  const allAttempts: PlayAttempt[] = [];
  const deferredRiskyCandidates: LadderCandidate[] = [];
  let obligationFloorRan = false;
  let totalCandidates = phaseMain.length;
  const attemptBudget: AttemptBudget = {
    limit: config.auto_play_max_attempts,
    used: 0,
  };

  if (phaseMain.length > 0) {
    const mainResult = await attemptCandidates({
      ...shared,
      deadline: mainDeadline,
      candidates: phaseMain,
      attemptOffset: 0,
      attemptBudget,
    });
    if (mainResult.kind === 'success') {
      return annotate({
        ...mainResult.result,
        attempts: mainResult.result.attempts,
        candidate_count: phaseMain.length,
      });
    }
    if (mainResult.kind === 'fatal') {
      throw pipelineFatalError(mainResult.error, mainResult.attempts);
    }
    allAttempts.push(...mainResult.attempts);
    deferredRiskyCandidates.push(...mainResult.deferred_risky);
  }

  const phaseResort = expandPlayLadder(streams, split.resort, filterContext, {
    strict_unknown_cache: config.strict_unknown_cache,
    preferred_quality: config.preferred_quality,
    preferred_hdr_tags: config.preferred_hdr_tags,
    preferred_video_codecs: config.preferred_video_codecs,
    max_candidates: Number.MAX_SAFE_INTEGER,
    include_uncached: true,
    hard_language: config.hard_language,
    preferred_language: config.preferred_language,
    min_quality: config.request_overrides?.min_quality,
    max_quality: config.request_overrides?.max_quality,
    exclude_remux: config.request_overrides?.exclude_remux,
  }).filter((candidate) => (
    !allAttempts.some((attempt) => attempt.url && attempt.url === candidate.stream.url)
  ));

  if (phaseResort.length > 0 && attemptBudget.used < attemptBudget.limit) {
    const resortDeadline = extendPhaseBIfNeeded(true);
    if (resortDeadline - Date.now() >= 500) {
    totalCandidates += phaseResort.length;
    const resortResult = await attemptCandidates({
      ...shared,
      deadline: resortDeadline,
      candidates: phaseResort,
      attemptOffset: allAttempts.length,
      attemptBudget,
    });
    if (resortResult.kind === 'success') {
      return annotate({
        ...resortResult.result,
        attempts: [...allAttempts, ...resortResult.result.attempts],
        candidate_count: totalCandidates,
      });
    }
    if (resortResult.kind === 'fatal') {
      throw pipelineFatalError(resortResult.error, [...allAttempts, ...resortResult.attempts]);
    }
    allAttempts.push(...resortResult.attempts);
    deferredRiskyCandidates.push(...resortResult.deferred_risky);
    }
  }

  if (attemptBudget.used < attemptBudget.limit) {
    const excludeUrls = new Set(
      allAttempts.map((attempt) => attempt.url).filter((url): url is string => Boolean(url)),
    );
    const phaseFloor = expandObligationFloor(streams, filterContext, {
      excludeUrls,
      maxCandidates: Number.MAX_SAFE_INTEGER,
      hard_language: config.hard_language,
      preferred_language: config.preferred_language,
      min_quality: config.request_overrides?.min_quality,
      max_quality: config.request_overrides?.max_quality,
      exclude_remux: config.request_overrides?.exclude_remux,
    });
    if (phaseFloor.length > 0) {
      const floorDeadline = extendPhaseBIfNeeded(true);
      if (floorDeadline - Date.now() >= 500) {
      obligationFloorRan = true;
      totalCandidates += phaseFloor.length;
      const floorResult = await attemptCandidates({
        ...shared,
        candidates: phaseFloor,
        attemptOffset: allAttempts.length,
        obligationFloorRan: true,
        deadline: floorDeadline,
        attemptBudget,
      });
      if (floorResult.kind === 'success') {
        return annotate({
          ...floorResult.result,
          attempts: [...allAttempts, ...floorResult.result.attempts],
          candidate_count: totalCandidates,
          obligation_floor_ran: true,
        });
      }
      if (floorResult.kind === 'fatal') {
        throw pipelineFatalError(floorResult.error, [...allAttempts, ...floorResult.attempts]);
      }
      allAttempts.push(...floorResult.attempts);
      deferredRiskyCandidates.push(...floorResult.deferred_risky);
      }
    }
  }

  if (
    deferredRiskyCandidates.length > 0
    && attemptBudget.used < attemptBudget.limit
    && phaseBDeadline - Date.now() >= 500
  ) {
    const fallbackResult = await attemptCandidates({
      ...shared,
      candidates: deferredRiskyCandidates,
      attemptOffset: allAttempts.length,
      obligationFloorRan: true,
      deferKnownRiskAfterProbe: false,
      deadline: phaseBDeadline,
      attemptBudget,
    });
    if (fallbackResult.kind === 'success') {
      return annotate({
        ...fallbackResult.result,
        attempts: [...allAttempts, ...fallbackResult.result.attempts],
        candidate_count: totalCandidates,
        obligation_floor_ran: true,
      });
    }
    if (fallbackResult.kind === 'fatal') {
      throw pipelineFatalError(fallbackResult.error, [...allAttempts, ...fallbackResult.attempts]);
    }
    allAttempts.push(...fallbackResult.attempts);
  }

  throw new CatalogError(502, 'no_playable_stream', {
    attempts: allAttempts,
    total_ms: Date.now() - started,
    candidates: totalCandidates,
    obligation_floor_ran: obligationFloorRan,
  });
}

export { couchStatusForLadderStep };

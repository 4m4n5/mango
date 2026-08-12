import { CatalogCore, CatalogError, type Stream } from '../core.js';
import { isRateLimitedStreamUrl } from '../catalog-errors.js';
import { classifyPlayError, garbageKind } from '../play-error-classify.js';
import { probeWithLadder } from '../play-orchestrator.js';
import { expandPlayLadder, streamReleaseFingerprint, type LadderCandidate } from '../play-ladder.js';
import { PlayabilityBatchWriter } from './batch-writer.js';
import {
  playabilitySeriesCrossProbeLimit,
  playabilityUseProbePool,
  playabilityVerifyMinDurationSec,
  playabilityVerifyTtlMs,
  playabilityVerifyZeroStreamRetryAttempts,
  playabilityVerifyZeroStreamRetryDelayMs,
} from './config.js';
import {
  getTitlePlayability,
  getTitleVerifyProfile,
  recordVerifyResult,
} from './db.js';
import { canonicalTitleId, normalizeSeriesVerifyId } from './ids.js';
import { probeUrlViaPool } from './mpv-probe-pool.js';
import { probeUrl } from '../mpv.js';
import type { RailThemeGate } from './rail-theme-gate.js';

export type VerifyTitleResult = {
  type: string;
  id: string;
  ok: boolean;
  identity_certifiable: boolean;
  exact_main_win: boolean;
  status: 'verified' | 'failed' | 'stale';
  reason?: string;
  resolve_ms?: number;
  prepare_ms?: number;
  probe_ms?: number;
  win_ladder_step?: string;
  stream?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  attempts: Array<{
    index: number;
    ladder_step?: string;
    source?: string;
    quality?: string;
    cache_status?: unknown;
    debrid_service?: unknown;
    ok: boolean;
    ms: number;
    error?: string;
  }>;
};

export type VerifyTitleOptions = {
  railId?: string | null;
  forceReprobe?: boolean;
  preserveVerified?: boolean;
  request?: VerificationRequestInput;
};

export type VerificationRequestInput = {
  requestId?: string | null;
  runId?: string | null;
  railId?: string | null;
  sourceKey?: string | null;
  title?: string | null;
  year?: string | number | null;
};

export type VerificationRequest = Readonly<{
  request_id: string;
  run_id: string | null;
  type: string;
  requested_id: string;
  canonical_title_id: string;
  verify_id: string;
  rail_id: string | null;
  source_key: string | null;
  title: string | null;
  year: string | null;
  season: number | null;
  episode: number | null;
  attempt_kind: 'main';
}>;

function boundedRequestText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

export function createVerificationRequest(
  type: string,
  id: string,
  input: VerificationRequestInput = {},
): VerificationRequest {
  const requestedId = id.trim();
  const verifyId = normalizeSeriesVerifyId(type, requestedId);
  const episodeMatch = type === 'series' ? verifyId.match(/:(\d+):(\d+)$/) : null;
  const runId = boundedRequestText(input.runId ?? process.env.MANGO_OPS_RUN_ID, 160);
  const sourceKey = boundedRequestText(input.sourceKey, 300);
  return Object.freeze({
    request_id: boundedRequestText(input.requestId, 160)
      ?? [runId ?? 'standalone', type, requestedId, sourceKey ?? 'unknown'].join(':'),
    run_id: runId,
    type,
    requested_id: requestedId,
    canonical_title_id: canonicalTitleId(type, requestedId),
    verify_id: verifyId,
    rail_id: boundedRequestText(input.railId, 160),
    source_key: sourceKey,
    title: boundedRequestText(input.title, 300),
    year: boundedRequestText(input.year, 16),
    season: episodeMatch ? Number(episodeMatch[1]) : null,
    episode: episodeMatch ? Number(episodeMatch[2]) : null,
    attempt_kind: 'main' as const,
  });
}

export type VerifyContext = {
  batchWriter?: PlayabilityBatchWriter | null;
  useProbePool?: boolean;
  themeGate?: RailThemeGate;
};

export type PreparedVerifyTitleResult = {
  type: string;
  id: string;
  ok: true;
  resolve_ms: number;
  prepare_ms: number;
  resolved: Awaited<ReturnType<CatalogCore['resolveForPlay']>>;
  candidates: LadderCandidate[];
  request: VerificationRequest;
} | {
  type: string;
  id: string;
  ok: false;
  reason: string;
  resolve_ms?: number;
  prepare_ms: number;
  filters?: Record<string, unknown>;
  request: VerificationRequest;
};

function requestProof(request: VerificationRequest, exactMainWin: boolean) {
  return {
    proof_version: 2 as const,
    exact_main_win: exactMainWin,
    run_id: request.run_id,
    request_id: request.request_id,
    request_title_id: request.requested_id,
    request_title: request.title,
    request_year: request.year,
    source_key: request.source_key,
    attempt_kind: request.attempt_kind,
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
    .join(' | ') || 'probe_failed';
}

function failReason(error: unknown): string {
  const message = cleanError(error);
  const lower = message.toLowerCase();
  const cls = classifyPlayError(message);
  const kind = garbageKind(message);

  if (lower.includes('identity_conflict')) return 'identity_conflict';

  if (kind === 'nfo' || /debrid_playback_unreadable/i.test(message)) {
    return 'transient_upstream';
  }
  if (cls === 'rate_limited') return 'rate_limited';
  if (kind === 'status_clip') return 'status_clip';
  if (kind === 'copyright' || lower.includes('copyright') || lower.includes('removed')) {
    return 'copyright';
  }
  if (cls === 'transient' && (lower.includes('timeout') || lower.includes('within'))) {
    return 'timeout';
  }
  if (cls === 'no_stream') return 'no_stream';
  // Special case: title mismatch when not already classified.
  if (cls === 'unknown' && lower.includes('title')) return 'title_mismatch';
  return 'probe_failed';
}

export function failedLadderReason(result: {
  attempts: Array<{ error?: string }>;
  candidate_count: number;
}): string {
  const lastError = result.attempts.at(-1)?.error;
  if (lastError) {
    return failReason(lastError);
  }
  return result.candidate_count === 0 ? 'no_stream' : 'probe_failed';
}

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

async function persistVerifyResult(
  record: Parameters<typeof recordVerifyResult>[0],
  context?: VerifyContext,
): Promise<void> {
  if (context?.batchWriter) {
    context.batchWriter.queueVerify(record);
    return;
  }
  await recordVerifyResult(record);
}

function isInfrastructureFailure(reason: string): boolean {
  return reason === 'timeout'
    || reason === 'probe_failed'
    || reason === 'rate_limited'
    || reason === 'rate_limit';
}

function isConfirmedPlaybackFailure(reason: string): boolean {
  return reason === 'no_stream'
    || reason === 'identity_conflict'
    || reason === 'title_mismatch'
    || reason === 'bad_stream'
    || reason === 'status_clip'
    || reason === 'copyright'
    || reason === 'play_failure';
}

async function recordFailure(
  type: string,
  id: string,
  reason: string,
  probeMs: number | null,
  options: VerifyTitleOptions,
  request: VerificationRequest,
  context?: VerifyContext,
): Promise<{ status: 'failed' | 'stale' | 'verified'; persisted: boolean }> {
  const staleReprobe = options.forceReprobe === true;
  const existing = await getTitlePlayability(type, id);

  if (
    options.preserveVerified !== false
    && existing?.status === 'verified'
    && !staleReprobe
    && reason !== 'identity_conflict'
  ) {
    return { status: 'verified', persisted: false };
  }

  // Couch play-first: do not overwrite a couch demotion (stale/play_miss) with
  // background failed unless this is an explicit force reprobe.
  if (
    !staleReprobe
    && existing?.status === 'stale'
    && existing.fail_reason === 'play_miss'
    && isConfirmedPlaybackFailure(reason)
  ) {
    return { status: 'stale', persisted: false };
  }

  const status = isConfirmedPlaybackFailure(reason) && !isInfrastructureFailure(reason)
    ? 'failed'
    : 'stale';
  await persistVerifyResult({
    type,
    id,
    status,
    rail_id: options.railId ?? null,
    fail_reason: reason,
    probe_ms: probeMs,
    stage: 'verify',
    outcome: staleReprobe ? `${status}_reprobe_failed` : reason,
    ...requestProof(request, false),
  }, context);
  return { status, persisted: true };
}

/** Demote verified titles when play-order top candidate no longer matches stored win_url_hash. */
export async function demoteVerifyIfDrifted(
  core: CatalogCore,
  type: string,
  id: string,
  context?: VerifyContext,
): Promise<'fresh' | 'stale'> {
  const verifyId = normalizeSeriesVerifyId(type, id);
  const existing = await getTitleVerifyProfile(type, verifyId);
  if (!existing || existing.status !== 'verified' || !existing.win_url_hash) {
    return 'fresh';
  }

  const prepared = await prepareVerifyTitle(core, type, id);
  if (!prepared.ok || !prepared.resolved) {
    return 'fresh';
  }

  const candidates = expandPlayLadder(
    prepared.resolved.streams,
    prepared.resolved.filters.main_ladder,
    prepared.resolved.filterContext,
    {
      strict_unknown_cache: prepared.resolved.filters.strict_unknown_cache,
      preferred_quality: prepared.resolved.filters.preferred_quality,
      preferred_hdr_tags: prepared.resolved.filters.preferred_hdr_tags,
      preferred_video_codecs: prepared.resolved.filters.preferred_video_codecs,
      max_candidates: prepared.resolved.filters.auto_play_max_attempts,
      include_uncached: false,
    },
  );
  if (candidates.length === 0) {
    return 'fresh';
  }

  const topHash = streamReleaseFingerprint(candidates[0].stream);
  if (topHash === existing.win_url_hash) {
    return 'fresh';
  }

  await persistVerifyResult({
    type,
    id: verifyId,
    status: 'stale',
    rail_id: null,
    fail_reason: 'verify_drift',
    stage: 'verify',
    outcome: 'verify_drift',
  }, context);
  return 'stale';
}

export async function verifyTitle(
  core: CatalogCore,
  type: string,
  id: string,
  options: VerifyTitleOptions = {},
  context?: VerifyContext,
): Promise<VerifyTitleResult> {
  return verifyPreparedTitle(
    await prepareVerifyTitle(core, type, id, options.request),
    options,
    context,
  );
}

export async function prepareVerifyTitle(
  core: CatalogCore,
  type: string,
  id: string,
  requestInput: VerificationRequestInput = {},
): Promise<PreparedVerifyTitleResult> {
  const started = Date.now();
  const request = createVerificationRequest(type, id, requestInput);
  const verifyId = request.verify_id;
  try {
    const resolved = await core.resolveForPlay(type, verifyId, {}, {
      seriesCrossProbeLimit: playabilitySeriesCrossProbeLimit(),
      zeroStreamRetryAttempts: playabilityVerifyZeroStreamRetryAttempts(),
      zeroStreamRetryDelayMs: playabilityVerifyZeroStreamRetryDelayMs(),
      requestClass: 'background',
      identityHint: {
        title: request.title ?? undefined,
        year: request.year ?? undefined,
      },
    });
    const candidates = expandPlayLadder(
      resolved.streams,
      resolved.filters.main_ladder,
      resolved.filterContext,
      {
        strict_unknown_cache: resolved.filters.strict_unknown_cache,
        preferred_quality: resolved.filters.preferred_quality,
        preferred_hdr_tags: resolved.filters.preferred_hdr_tags,
        preferred_video_codecs: resolved.filters.preferred_video_codecs,
        max_candidates: resolved.filters.auto_play_max_attempts,
        include_uncached: false,
      },
    );

    if (candidates.length === 0) {
      return {
        type,
        id,
        ok: false,
        reason: 'no_stream',
        resolve_ms: resolved.resolve_ms,
        prepare_ms: Date.now() - started,
        filters: {
          applied: resolved.filters,
          play_ladder: resolved.filters.play_ladder.map((step) => step.step),
        },
        request,
      };
    }

    return {
      type,
      id,
      ok: true,
      resolve_ms: resolved.resolve_ms,
      prepare_ms: Date.now() - started,
      resolved,
      candidates,
      request,
    };
  } catch (error) {
    const reason = failReason(error);
    return {
      type,
      id,
      ok: false,
      reason,
      prepare_ms: Date.now() - started,
      filters: error instanceof CatalogError
        ? error.details?.filters as Record<string, unknown> | undefined
        : undefined,
      request,
    };
  }
}

export async function verifyPreparedTitle(
  prepared: PreparedVerifyTitleResult,
  options: VerifyTitleOptions = {},
  context?: VerifyContext,
): Promise<VerifyTitleResult> {
  if (!prepared.ok) {
    const recorded = await recordFailure(
      prepared.type,
      prepared.id,
      prepared.reason,
      null,
      options,
      prepared.request,
      context,
    );
    return {
      type: prepared.type,
      id: prepared.id,
      ok: false,
      identity_certifiable: false,
      exact_main_win: false,
      status: recorded.status,
      reason: prepared.reason,
      resolve_ms: prepared.resolve_ms,
      prepare_ms: prepared.prepare_ms,
      filters: prepared.filters,
      attempts: [],
    };
  }

  const usePool = context?.useProbePool ?? playabilityUseProbePool();
  const probe = usePool
    ? (url: string, timeoutMs: number) => probeUrlViaPool(url, timeoutMs, playabilityVerifyMinDurationSec(prepared.type))
    : probeUrl;

  const ladderResult = await probeWithLadder(
    prepared.resolved.streams,
    prepared.resolved.filters,
    {
      ladder: prepared.resolved.filters.main_ladder ?? prepared.resolved.filters.play_ladder,
      contentType: prepared.type,
      filterContext: prepared.resolved.filterContext,
      include_uncached: false,
      candidates: prepared.candidates,
      probe: async (url, timeoutMs) => {
        if (isRateLimitedStreamUrl(url)) {
          throw new Error('rate_limited');
        }
        return probe(url, timeoutMs);
      },
    },
  );

  const responseFilters = {
    applied: prepared.resolved.filters,
    play_ladder: prepared.resolved.filters.play_ladder.map((step) => step.step),
  };

  if (ladderResult.ok) {
    const stream = ladderResult.stream;
    await persistVerifyResult({
      type: prepared.type,
      id: prepared.id,
      status: 'verified',
      rail_id: options.railId ?? null,
      best_source: stream.source,
      cache_status: typeof stream.cache_status === 'string' ? stream.cache_status : null,
      debrid_service: typeof stream.debrid_service === 'string' ? stream.debrid_service : null,
      probe_ms: ladderResult.probe_ms,
      win_url_hash: streamReleaseFingerprint(stream),
      win_ladder_step: ladderResult.ladder_step,
      expires_at: Date.now() + playabilityVerifyTtlMs(),
      stage: 'verify',
      outcome: 'verified',
      ...requestProof(prepared.request, true),
    }, context);
    return {
      type: prepared.type,
      id: prepared.id,
      ok: true,
      identity_certifiable: true,
      exact_main_win: true,
      status: 'verified',
      resolve_ms: prepared.resolve_ms,
      prepare_ms: prepared.prepare_ms,
      probe_ms: ladderResult.probe_ms,
      win_ladder_step: ladderResult.ladder_step,
      stream: streamMeta(stream, ladderResult.ladder_step),
      filters: responseFilters,
      attempts: ladderResult.attempts,
    };
  }

  const reason = failedLadderReason(ladderResult);
  const recorded = await recordFailure(
    prepared.type,
    prepared.id,
    reason,
    ladderResult.attempts.reduce((total, attempt) => total + attempt.ms, 0),
    options,
    prepared.request,
    context,
  );
  return {
    type: prepared.type,
    id: prepared.id,
    ok: false,
    identity_certifiable: false,
    exact_main_win: false,
    status: recorded.status,
    reason,
    resolve_ms: prepared.resolve_ms,
    prepare_ms: prepared.prepare_ms,
    filters: responseFilters,
    attempts: ladderResult.attempts,
  };
}

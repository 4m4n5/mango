import { CatalogCore, CatalogError, type Stream } from '../core.js';
import { isRateLimitedStreamUrl } from '../catalog-errors.js';
import { probeWithLadder } from '../play-orchestrator.js';
import { expandPlayLadder } from '../play-ladder.js';
import { streamUrlHash } from '../stream-filters.js';
import { PlayabilityBatchWriter } from './batch-writer.js';
import {
  playabilityUseProbePool,
  playabilityVerifyMinDurationSec,
  playabilityVerifyTtlMs,
} from './config.js';
import {
  getTitlePlayability,
  recordVerifyResult,
} from './db.js';
import { normalizeSeriesVerifyId } from './ids.js';
import { probeUrlViaPool } from './mpv-probe-pool.js';
import { probeUrl } from '../mpv.js';

export type VerifyTitleResult = {
  type: string;
  id: string;
  ok: boolean;
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
};

export type VerifyContext = {
  batchWriter?: PlayabilityBatchWriter | null;
  useProbePool?: boolean;
};

export type PreparedVerifyTitleResult = {
  type: string;
  id: string;
  ok: true;
  resolve_ms: number;
  prepare_ms: number;
  resolved: Awaited<ReturnType<CatalogCore['resolveForPlay']>>;
} | {
  type: string;
  id: string;
  ok: false;
  reason: string;
  resolve_ms?: number;
  prepare_ms: number;
  filters?: Record<string, unknown>;
};

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
  const message = cleanError(error).toLowerCase();
  if (message.includes('debrid_nfo') || message.includes('debrid_playback_unreadable')) {
    return 'bad_stream';
  }
  if (message.includes('rate_limit') || message.includes('rate limit')) return 'rate_limit';
  if (message.includes('debrid_status_clip')) return 'status_clip';
  if (message.includes('copyright') || message.includes('removed')) return 'copyright';
  if (message.includes('timeout') || message.includes('within')) return 'timeout';
  if (message.includes('no streams') || message.includes('no_playable')) return 'no_stream';
  if (message.includes('title')) return 'title_mismatch';
  return 'probe_failed';
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

function isTransientFailure(reason: string): boolean {
  return reason === 'timeout' || reason === 'probe_failed' || reason === 'no_stream' || reason === 'bad_stream';
}

async function recordFailure(
  type: string,
  id: string,
  reason: string,
  probeMs: number | null,
  options: VerifyTitleOptions,
  context?: VerifyContext,
): Promise<'failed' | 'stale' | 'preserved'> {
  const staleReprobe = options.forceReprobe === true;
  const existing = await getTitlePlayability(type, id);

  if (
    options.preserveVerified !== false
    && existing?.status === 'verified'
    && !staleReprobe
  ) {
    return 'preserved';
  }

  const demoteToStale = staleReprobe || (existing?.status === 'verified' && isTransientFailure(reason));
  const status = demoteToStale ? 'stale' : 'failed';
  await persistVerifyResult({
    type,
    id,
    status,
    rail_id: options.railId ?? null,
    fail_reason: reason,
    probe_ms: probeMs,
    stage: 'verify',
    outcome: demoteToStale ? 'stale_reprobe_failed' : reason,
  }, context);
  return status;
}

export async function verifyTitle(
  core: CatalogCore,
  type: string,
  id: string,
  options: VerifyTitleOptions = {},
  context?: VerifyContext,
): Promise<VerifyTitleResult> {
  return verifyPreparedTitle(await prepareVerifyTitle(core, type, id), options, context);
}

export async function prepareVerifyTitle(
  core: CatalogCore,
  type: string,
  id: string,
): Promise<PreparedVerifyTitleResult> {
  const started = Date.now();
  const verifyId = normalizeSeriesVerifyId(type, id);
  try {
    const resolved = await core.resolveForPlay(type, verifyId);
    const candidates = expandPlayLadder(
      resolved.streams,
      resolved.filters.play_ladder,
      resolved.filterContext,
      {
        strict_unknown_cache: resolved.filters.strict_unknown_cache,
        preferred_quality: resolved.filters.preferred_quality,
        max_candidates: resolved.filters.auto_play_max_attempts,
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
      };
    }

    return {
      type,
      id,
      ok: true,
      resolve_ms: resolved.resolve_ms,
      prepare_ms: Date.now() - started,
      resolved,
    };
  } catch (error) {
    const reason = error instanceof CatalogError
      ? 'no_stream'
      : failReason(error);
    return {
      type,
      id,
      ok: false,
      reason,
      prepare_ms: Date.now() - started,
      filters: error instanceof CatalogError
        ? error.details?.filters as Record<string, unknown> | undefined
        : undefined,
    };
  }
}

export async function verifyPreparedTitle(
  prepared: PreparedVerifyTitleResult,
  options: VerifyTitleOptions = {},
  context?: VerifyContext,
): Promise<VerifyTitleResult> {
  if (!prepared.ok) {
    const recorded = await recordFailure(prepared.type, prepared.id, prepared.reason, null, options, context);
    return {
      type: prepared.type,
      id: prepared.id,
      ok: false,
      status: recorded === 'preserved' ? 'verified' : recorded,
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
      ladder: prepared.resolved.filters.play_ladder,
      contentType: prepared.type,
      filterContext: prepared.resolved.filterContext,
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
      win_url_hash: streamUrlHash(stream.url),
      win_ladder_step: ladderResult.ladder_step,
      expires_at: Date.now() + playabilityVerifyTtlMs(),
      stage: 'verify',
      outcome: 'verified',
    }, context);
    return {
      type: prepared.type,
      id: prepared.id,
      ok: true,
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

  const reason = ladderResult.attempts.at(-1)?.error
    ? failReason(ladderResult.attempts.at(-1)?.error)
    : 'probe_failed';
  const recorded = await recordFailure(
    prepared.type,
    prepared.id,
    reason,
    ladderResult.attempts.reduce((total, attempt) => total + attempt.ms, 0),
    options,
    context,
  );
  return {
    type: prepared.type,
    id: prepared.id,
    ok: false,
    status: recorded === 'preserved' ? 'verified' : recorded,
    reason,
    resolve_ms: prepared.resolve_ms,
    prepare_ms: prepared.prepare_ms,
    filters: responseFilters,
    attempts: ladderResult.attempts,
  };
}

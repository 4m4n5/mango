import { createHash } from 'node:crypto';
import { CatalogCore, CatalogError, type Stream } from '../core.js';
import { isRateLimitedStreamUrl } from '../catalog-errors.js';
import { probeUrl } from '../mpv.js';
import {
  selectAutoPlayCandidates,
  type StreamFilterMeta,
} from '../stream-filters.js';
import { PlayabilityBatchWriter } from './batch-writer.js';
import {
  playabilityProbeTimeoutMs,
  playabilityUseProbePool,
  playabilityVerifyMinDurationSec,
  playabilityVerifyTtlMs,
} from './config.js';
import {
  enqueueSeriesFollowUpEpisodes,
  getTitlePlayability,
  recordVerifyResult,
} from './db.js';
import { normalizeSeriesVerifyId } from './ids.js';
import { probeUrlViaPool } from './mpv-probe-pool.js';
import { limitVerifyCandidates } from './verify-candidates.js';

export type VerifyTitleResult = {
  type: string;
  id: string;
  ok: boolean;
  status: 'verified' | 'failed' | 'stale';
  reason?: string;
  resolve_ms?: number;
  prepare_ms?: number;
  probe_ms?: number;
  stream?: Record<string, unknown>;
  filters?: StreamFilterMeta;
  attempts: Array<{
    index: number;
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
  filters: StreamFilterMeta;
  candidates: Stream[];
} | {
  type: string;
  id: string;
  ok: false;
  reason: string;
  resolve_ms?: number;
  prepare_ms: number;
  filters?: StreamFilterMeta;
};

function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
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
  const message = cleanError(error).toLowerCase();
  if (message.includes('rate_limit') || message.includes('rate limit')) return 'rate_limit';
  if (message.includes('debrid_status_clip')) return 'status_clip';
  if (message.includes('copyright') || message.includes('removed')) return 'copyright';
  if (message.includes('timeout') || message.includes('within')) return 'timeout';
  if (message.includes('no streams')) return 'no_stream';
  if (message.includes('title')) return 'title_mismatch';
  return 'probe_failed';
}

function streamMeta(stream: Stream): Record<string, unknown> {
  return {
    source: stream.source,
    title: stream.title,
    quality: stream.quality,
    cache_status: stream.cache_status,
    debrid_service: stream.debrid_service,
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

async function probeStreamUrl(
  url: string,
  contentType: string,
  context?: VerifyContext,
): Promise<{ ttff_ms: number }> {
  const timeoutMs = playabilityProbeTimeoutMs();
  const minDurationSec = playabilityVerifyMinDurationSec(contentType);
  const usePool = context?.useProbePool ?? playabilityUseProbePool();
  if (usePool) {
    return probeUrlViaPool(url, timeoutMs, minDurationSec);
  }
  return probeUrl(url, timeoutMs, minDurationSec);
}

function isTransientFailure(reason: string): boolean {
  return reason === 'timeout' || reason === 'probe_failed' || reason === 'no_stream';
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

  // Re-probes should never demote a title to failed — stale keeps it in pool for retry.
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
    const streamResult = await core.streams(type, verifyId);
    const candidates = limitVerifyCandidates(
      selectAutoPlayCandidates(streamResult.streams, streamResult.filters.applied, {
        allow_uncached_torbox: streamResult.filters.torbox_uncached_fallback === true,
      }),
    );

    if (candidates.length === 0) {
      return {
        type,
        id,
        ok: false,
        reason: 'no_stream',
        resolve_ms: streamResult.resolve_ms,
        prepare_ms: Date.now() - started,
        filters: streamResult.filters,
      };
    }

    return {
      type,
      id,
      ok: true,
      resolve_ms: streamResult.resolve_ms,
      prepare_ms: Date.now() - started,
      filters: streamResult.filters,
      candidates,
    };
  } catch (error) {
    const reason = error instanceof CatalogError && error.details?.filters
      ? 'no_stream'
      : failReason(error);
    return {
      type,
      id,
      ok: false,
      reason,
      prepare_ms: Date.now() - started,
      filters: error instanceof CatalogError ? error.details?.filters as StreamFilterMeta | undefined : undefined,
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

  const attempts: VerifyTitleResult['attempts'] = [];
  for (const [index, stream] of prepared.candidates.entries()) {
    const started = Date.now();
    if (isRateLimitedStreamUrl(stream.url)) {
      attempts.push({
        index,
        source: stream.source,
        quality: stream.quality,
        cache_status: stream.cache_status,
        debrid_service: stream.debrid_service,
        ok: false,
        ms: Date.now() - started,
        error: 'rate_limited',
      });
      continue;
    }
    try {
      const probe = await probeStreamUrl(stream.url, prepared.type, context);
      const probeMs = Date.now() - started;
      attempts.push({
        index,
        source: stream.source,
        quality: stream.quality,
        cache_status: stream.cache_status,
        debrid_service: stream.debrid_service,
        ok: true,
        ms: probeMs,
      });
      await persistVerifyResult({
        type: prepared.type,
        id: prepared.id,
        status: 'verified',
        rail_id: options.railId ?? null,
        best_source: stream.source,
        cache_status: typeof stream.cache_status === 'string' ? stream.cache_status : null,
        debrid_service: typeof stream.debrid_service === 'string' ? stream.debrid_service : null,
        probe_ms: probe.ttff_ms,
        win_url_hash: urlHash(stream.url),
        expires_at: Date.now() + playabilityVerifyTtlMs(),
        stage: 'verify',
        outcome: 'verified',
      }, context);
      if (prepared.type === 'series') {
        void enqueueSeriesFollowUpEpisodes(prepared.id).catch(() => undefined);
      }
      return {
        type: prepared.type,
        id: prepared.id,
        ok: true,
        status: 'verified',
        resolve_ms: prepared.resolve_ms,
        prepare_ms: prepared.prepare_ms,
        probe_ms: probe.ttff_ms,
        stream: streamMeta(stream),
        filters: prepared.filters,
        attempts,
      };
    } catch (error) {
      attempts.push({
        index,
        source: stream.source,
        quality: stream.quality,
        cache_status: stream.cache_status,
        debrid_service: stream.debrid_service,
        ok: false,
        ms: Date.now() - started,
        error: cleanError(error),
      });
    }
  }

  const reason = attempts.at(-1)?.error ? failReason(attempts.at(-1)?.error) : 'probe_failed';
  const recorded = await recordFailure(
    prepared.type,
    prepared.id,
    reason,
    attempts.reduce((total, attempt) => total + attempt.ms, 0),
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
    filters: prepared.filters,
    attempts,
  };
}

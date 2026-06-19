import { createHash } from 'node:crypto';
import { CatalogCore, CatalogError, type Stream } from '../core.js';
import { probeUrl } from '../mpv.js';
import {
  selectAutoPlayCandidates,
  type StreamFilterMeta,
} from '../stream-filters.js';
import { recordVerifyResult } from './db.js';

const VERIFY_PROBE_MS = Number(process.env.MANGO_PLAYABILITY_PROBE_MS || 12000);
const VERIFY_MIN_DURATION_SEC = Number(process.env.MANGO_PLAYABILITY_MIN_DURATION_SEC || 600);
const VERIFY_MAX_CANDIDATES = Number(process.env.MANGO_PLAYABILITY_MAX_CANDIDATES || 3);
const VERIFY_TTL_MS = Number(process.env.MANGO_PLAYABILITY_TTL_MS || 48 * 60 * 60 * 1000);

export type VerifyTitleResult = {
  type: string;
  id: string;
  ok: boolean;
  status: 'verified' | 'failed';
  reason?: string;
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

async function recordFailure(
  type: string,
  id: string,
  reason: string,
  probeMs: number | null,
  options: VerifyTitleOptions,
): Promise<void> {
  await recordVerifyResult({
    type,
    id,
    status: 'failed',
    rail_id: options.railId ?? null,
    fail_reason: reason,
    probe_ms: probeMs,
    stage: 'verify',
    outcome: reason,
  });
}

export async function verifyTitle(
  core: CatalogCore,
  type: string,
  id: string,
  options: VerifyTitleOptions = {},
): Promise<VerifyTitleResult> {
  let streams: Stream[] = [];
  let filters: StreamFilterMeta | undefined;

  try {
    const streamResult = await core.streams(type, id);
    streams = streamResult.streams;
    filters = streamResult.filters;
  } catch (error) {
    const reason = error instanceof CatalogError && error.details?.filters
      ? 'no_stream'
      : failReason(error);
    await recordFailure(type, id, reason, null, options);
    return {
      type,
      id,
      ok: false,
      status: 'failed',
      reason,
      filters: error instanceof CatalogError ? error.details?.filters as StreamFilterMeta | undefined : undefined,
      attempts: [],
    };
  }

  const candidates = selectAutoPlayCandidates(streams, filters.applied, {
    allow_uncached_torbox: filters.torbox_uncached_fallback === true,
  }).slice(0, VERIFY_MAX_CANDIDATES);

  if (candidates.length === 0) {
    await recordFailure(type, id, 'no_stream', null, options);
    return {
      type,
      id,
      ok: false,
      status: 'failed',
      reason: 'no_stream',
      filters,
      attempts: [],
    };
  }

  const attempts: VerifyTitleResult['attempts'] = [];
  for (const [index, stream] of candidates.entries()) {
    const started = Date.now();
    try {
      const probe = await probeUrl(stream.url, VERIFY_PROBE_MS, VERIFY_MIN_DURATION_SEC);
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
      await recordVerifyResult({
        type,
        id,
        status: 'verified',
        rail_id: options.railId ?? null,
        best_source: stream.source,
        cache_status: typeof stream.cache_status === 'string' ? stream.cache_status : null,
        debrid_service: typeof stream.debrid_service === 'string' ? stream.debrid_service : null,
        probe_ms: probe.ttff_ms,
        win_url_hash: urlHash(stream.url),
        expires_at: Date.now() + VERIFY_TTL_MS,
        stage: 'verify',
        outcome: 'verified',
      });
      return {
        type,
        id,
        ok: true,
        status: 'verified',
        probe_ms: probe.ttff_ms,
        stream: streamMeta(stream),
        filters,
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
  await recordFailure(
    type,
    id,
    reason,
    attempts.reduce((total, attempt) => total + attempt.ms, 0),
    options,
  );
  return {
    type,
    id,
    ok: false,
    status: 'failed',
    reason,
    filters,
    attempts,
  };
}

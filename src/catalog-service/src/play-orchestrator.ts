import { CatalogError, type Stream } from './core.js';
import { playUrl } from './mpv.js';
import { assertPlayEpoch, PlayCancelledError } from './play-cancel.js';
import {
  selectAutoPlayCandidates,
  type StreamFilterConfig,
  type VerifiedStreamHint,
} from './stream-filters.js';

export type PlayOrchestratorConfig = StreamFilterConfig & { include_uncached: boolean };

export type PlayAttempt = {
  index: number;
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
  total_ms: number;
  attempts: PlayAttempt[];
  stream: Record<string, unknown>;
  candidate_count: number;
};

function streamMeta(stream: Stream): Record<string, unknown> {
  return {
    source: stream.source,
    title: stream.title,
    quality: stream.quality,
    cache_status: stream.cache_status,
    debrid_service: stream.debrid_service,
  };
}

function attemptBase(index: number, stream: Stream): Omit<PlayAttempt, 'ok' | 'ms'> {
  return {
    index,
    source: stream.source,
    quality: stream.quality,
    cache_status: stream.cache_status,
    debrid_service: stream.debrid_service,
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

export async function playWithFallback(
  streams: Stream[],
  config: PlayOrchestratorConfig,
  options: {
    allow_uncached_torbox?: boolean;
    allow_rd_safe_unknown?: boolean;
    contentType?: string;
    verified_hint?: VerifiedStreamHint;
    playEpoch?: number;
  } = {},
): Promise<PlayOrchestratorResult> {
  const started = Date.now();
  const extendedBudget = options.allow_uncached_torbox === true || options.allow_rd_safe_unknown === true;
  const wallMs = extendedBudget
    ? Math.max(config.auto_play_wall_ms, 60000)
    : Math.max(config.auto_play_wall_ms, 30000);
  const probeMs = extendedBudget
    ? Math.max(config.auto_play_probe_ms, 20000)
    : config.auto_play_probe_ms;
  const deadline = started + wallMs;
  const candidates = selectAutoPlayCandidates(streams, config, {
    allow_uncached_torbox: options.allow_uncached_torbox,
    verified_hint: options.verified_hint,
  });
  const minDurationSec = options.contentType === 'series' ? 600 : 600;
  const attempts: PlayAttempt[] = [];

  if (candidates.length === 0) {
    throw new CatalogError(502, 'no_playable_stream', {
      attempts,
      total_ms: Date.now() - started,
      candidates: 0,
    });
  }

  for (const [index, stream] of candidates.entries()) {
    if (options.playEpoch !== undefined) {
      await assertPlayEpoch(options.playEpoch);
    }
    const remainingBeforeProbe = deadline - Date.now();
    if (remainingBeforeProbe < 500) {
      break;
    }

    const attemptStarted = Date.now();
    const base = attemptBase(index, stream);
    try {
      const attemptBudget = Math.min(
        Math.max(probeMs, 6000),
        remainingBeforeProbe,
      );
      const playback = await playUrl(stream.url, attemptBudget, {
        minDurationSec,
        playEpoch: options.playEpoch,
      });
      const attempt: PlayAttempt = {
        ...base,
        ok: true,
        ms: Date.now() - attemptStarted,
        ttff_ms: playback.ttff_ms,
      };
      attempts.push(attempt);
      return {
        ok: true,
        ttff_ms: playback.ttff_ms,
        total_ms: Date.now() - started,
        attempts,
        stream: streamMeta(stream),
        candidate_count: candidates.length,
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

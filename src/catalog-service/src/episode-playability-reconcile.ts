import { assertPlayEpoch, guardPlayMutation } from './play-cancel.js';
import { playabilityVerifyTtlMs } from './playability/config.js';
import {
  recordVerifyResult,
  type PlayabilityVerifyRecord,
} from './playability/db.js';
import { isSeriesEpisodeId } from './playability/ids.js';

export type SuccessfulEpisodePlayback = {
  ok: boolean;
  /** Only a win from the requested title's main ladder may create durable proof. */
  win_on_main?: boolean;
  stream: {
    source?: unknown;
    cache_status?: unknown;
    debrid_service?: unknown;
  };
  probe_ms?: number | null;
  win_url_hash?: string | null;
  win_ladder_step?: string | null;
};

type ReconcileDependencies = {
  assertCurrent?: (epoch: number) => Promise<void>;
  writeResult?: (record: PlayabilityVerifyRecord) => Promise<void>;
  now?: () => number;
  verifyTtlMs?: () => number;
};

/**
 * Clear a stale failed row after a real automatic couch play of a non-gate
 * series episode. Bare-series and :1:1 rail-gate promotion remains owned by
 * index.ts's existing playability path; this helper never assigns a rail.
 */
export async function reconcileSuccessfulEpisodePlayability(
  input: {
    contentType: string;
    playId: string;
    playMode: 'auto' | 'picker';
    usePlayabilityIndex: boolean;
    playEpoch: number;
    playback: SuccessfulEpisodePlayback;
  },
  dependencies: ReconcileDependencies = {},
): Promise<boolean> {
  if (
    input.contentType !== 'series'
    || !isSeriesEpisodeId(input.playId)
    || input.usePlayabilityIndex
    || input.playMode !== 'auto'
    || input.playback.ok !== true
    || input.playback.win_on_main !== true
  ) {
    return false;
  }

  const assertCurrent = dependencies.assertCurrent ?? assertPlayEpoch;
  const writeResult = dependencies.writeResult ?? recordVerifyResult;
  const now = dependencies.now ?? Date.now;
  const verifyTtlMs = dependencies.verifyTtlMs ?? playabilityVerifyTtlMs;

  await guardPlayMutation(input.playEpoch, () => writeResult({
    type: 'series',
    id: input.playId,
    status: 'verified',
    rail_id: null,
    best_source: typeof input.playback.stream.source === 'string'
      ? input.playback.stream.source
      : null,
    cache_status: typeof input.playback.stream.cache_status === 'string'
      ? input.playback.stream.cache_status
      : null,
    debrid_service: typeof input.playback.stream.debrid_service === 'string'
      ? input.playback.stream.debrid_service
      : null,
    probe_ms: input.playback.probe_ms ?? null,
    win_url_hash: input.playback.win_url_hash ?? null,
    win_ladder_step: input.playback.win_ladder_step ?? null,
    expires_at: now() + verifyTtlMs(),
    stage: 'play',
    outcome: 'verified',
    proof_version: 2,
    exact_main_win: true,
    request_id: input.playId,
    request_title_id: input.playId,
    run_id: process.env.MANGO_OPS_RUN_ID ?? null,
  }), assertCurrent);
  return true;
}

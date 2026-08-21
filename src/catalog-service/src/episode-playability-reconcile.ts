import { assertPlayEpoch, guardPlayMutation } from './play-cancel.js';
import { playabilityVerifyTtlMs } from './playability/config.js';
import {
  demoteTitle,
  enqueuePlayabilityTrigger,
  getTitlePlayability,
  invalidateTitle,
  recordVerifyResult,
  type TitlePlayabilityRecord,
  type PlayabilityVerifyRecord,
} from './playability/db.js';
import { isSeriesEpisodeId } from './playability/ids.js';
import {
  shouldConfirmPlayFailure,
  shouldDemoteAfterPlayError,
} from './playability/play-failure-policy.js';

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

export type FailedEpisodePlayabilityAction = 'retry' | 'stale' | 'failed';

type FailureReconcileDependencies = {
  assertCurrent?: (epoch: number) => Promise<void>;
  readState?: (type: string, id: string) => Promise<TitlePlayabilityRecord | null>;
  demote?: typeof demoteTitle;
  invalidate?: typeof invalidateTitle;
  enqueue?: typeof enqueuePlayabilityTrigger;
  now?: () => number;
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
    identityCertifiable?: boolean;
    playEpoch: number;
    playback: SuccessfulEpisodePlayback;
  },
  dependencies: ReconcileDependencies = {},
): Promise<boolean> {
  if (
    input.contentType !== 'series'
    || !isSeriesEpisodeId(input.playId)
    || input.usePlayabilityIndex
    || input.identityCertifiable === false
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

/**
 * Reconcile a failed automatic play for an exact, non-gate series episode.
 * The exact episode owns its own stale/failed state and retry trigger; this
 * helper never mutates the bare show identity or assigns a Home rail.
 */
export async function reconcileFailedEpisodePlayability(
  input: {
    contentType: string;
    playId: string;
    playMode: 'auto' | 'picker';
    usePlayabilityIndex: boolean;
    playEpoch: number;
    isNoPlayableStream: boolean;
    attempts?: unknown;
    candidates?: unknown;
    obligationFloorRan?: boolean;
  },
  dependencies: FailureReconcileDependencies = {},
): Promise<FailedEpisodePlayabilityAction | null> {
  if (
    input.contentType !== 'series'
    || !isSeriesEpisodeId(input.playId)
    || input.usePlayabilityIndex
    || input.playMode !== 'auto'
  ) {
    return null;
  }

  const assertCurrent = dependencies.assertCurrent ?? assertPlayEpoch;
  const readState = dependencies.readState ?? getTitlePlayability;
  const demote = dependencies.demote ?? demoteTitle;
  const invalidate = dependencies.invalidate ?? invalidateTitle;
  const enqueue = dependencies.enqueue ?? enqueuePlayabilityTrigger;
  const now = dependencies.now ?? Date.now;

  const prior = await readState('series', input.playId);
  const policyInput = {
    isNoPlayableStream: input.isNoPlayableStream,
    attempts: input.attempts,
    candidates: input.candidates,
    obligationFloorRan: input.obligationFloorRan === true,
    priorFailReason: prior?.fail_reason ?? null,
    priorUpdatedAt: prior?.updated_at ?? null,
    nowMs: now(),
  };
  const confirmFailure = shouldConfirmPlayFailure(policyInput);
  const demoteFailure = !confirmFailure && shouldDemoteAfterPlayError(policyInput);

  if (confirmFailure) {
    await guardPlayMutation(input.playEpoch, () => invalidate({
      rail_id: null,
      type: 'series',
      id: input.playId,
      reason: 'play_failure',
    }), assertCurrent);
  } else if (demoteFailure) {
    await guardPlayMutation(input.playEpoch, () => demote({
      rail_id: null,
      type: 'series',
      id: input.playId,
      reason: 'play_miss',
    }), assertCurrent);
  }

  const action: FailedEpisodePlayabilityAction = confirmFailure
    ? 'failed'
    : demoteFailure ? 'stale' : 'retry';
  await guardPlayMutation(input.playEpoch, () => enqueue({
    trigger_type: 'play_failure_reverify',
    rail_id: null,
    type: 'series',
    id: input.playId,
    reason: action === 'failed' ? 'play_failure' : action === 'stale' ? 'play_miss' : 'play_retry',
  }), assertCurrent);
  return action;
}

import type { CatalogCore } from '../core.js';
import type { AddonCatalogRail } from '../rails.js';
import type { CandidateMeta } from './list-source.js';
import { PlayabilityBatchWriter } from './batch-writer.js';
import {
  playabilityBatchDbEnabled,
  playabilityFailedRetryMs,
  playabilityProbeConcurrency,
  playabilityResolveConcurrency,
  playabilityUseProbePool,
} from './config.js';
import {
  getRailPoolTitleKeys,
  getTitlesPlayabilityBulk,
  upsertRailPoolTitle,
  type PlayabilityRailStatus,
  type TitlePlayabilityRecord,
} from './db.js';
import { ensureProbePool, stopProbePool } from './mpv-probe-pool.js';
import {
  prepareVerifyTitle,
  verifyPreparedTitle,
  type PreparedVerifyTitleResult,
  type VerifyContext,
} from './verify.js';

export type CandidateKey = string;

export type RailCandidateRef = {
  railId: string;
  index: number;
  candidate: CandidateMeta;
};

export type VerifyQueueItem = {
  key: CandidateKey;
  candidate: CandidateMeta;
  refs: RailCandidateRef[];
  forceReprobe: boolean;
};

type PreparedQueueItem = {
  queueId: number;
  item: VerifyQueueItem;
  prepared: PreparedVerifyTitleResult;
};

export function candidateKey(candidate: CandidateMeta): CandidateKey {
  return `${candidate.type}:${candidate.id}`;
}

export function valueAsString(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function scoreForCandidate(index: number, stream?: Record<string, unknown>): number {
  let score = 1_000_000 - index;
  const cacheStatus = valueAsString(stream?.cache_status);
  const debridService = valueAsString(stream?.debrid_service);
  const quality = valueAsString(stream?.quality);

  if (cacheStatus === 'cached') score += 10_000;
  else if (cacheStatus === 'unknown') score += 1_000;

  if (debridService === 'torbox') score += 500;
  else if (debridService === 'realdebrid') score += 250;

  if (quality === '1080p') score += 100;
  else if (quality === '720p') score += 50;

  return score;
}

export function uniqueCandidates(candidates: CandidateMeta[]): CandidateMeta[] {
  const seen = new Set<string>();
  const unique: CandidateMeta[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

async function queuePoolLink(
  railId: string,
  candidate: CandidateMeta,
  index: number,
  stream: Record<string, unknown> | undefined,
  context: VerifyContext,
): Promise<void> {
  const entry = {
    rail_id: railId,
    type: candidate.type,
    id: candidate.id,
    score: scoreForCandidate(index, stream),
  };
  if (context.batchWriter) {
    context.batchWriter.queuePool(entry);
    return;
  }
  await upsertRailPoolTitle(entry);
}

export type ProcessVerifyQueueResult = {
  verified: number;
  failed: number;
  linked_existing: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: 'linked_existing' | 'verified' | 'failed' | 'skipped_existing' | 'skipped_recent_failed' | 'reverified';
    reason?: string;
    rails?: string[];
  }>;
};

export type ProcessVerifyQueueOptions = {
  core: CatalogCore;
  queue: VerifyQueueItem[];
  railVerifiedCounts: Map<string, number>;
  railPoolTargets: Map<string, number>;
  railPoolKeys: Map<string, Set<string>>;
  context?: VerifyContext;
};

export async function processVerifyQueue(
  options: ProcessVerifyQueueOptions,
): Promise<ProcessVerifyQueueResult> {
  const {
    core,
    queue,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    context = {},
  } = options;

  const results: ProcessVerifyQueueResult['results'] = [];
  let verified = 0;
  let failed = 0;

  const resolveConcurrency = playabilityResolveConcurrency();
  const probeConcurrency = playabilityProbeConcurrency();
  let nextVerifyIndex = 0;
  let nextQueueId = 0;
  const prepareInFlight = new Map<number, Promise<PreparedQueueItem>>();
  const pendingProbes: PreparedQueueItem[] = [];
  const activeProbes = new Set<Promise<void>>();

  const railStillNeeds = (railId: string): boolean => {
    const target = railPoolTargets.get(railId) ?? 0;
    const current = railVerifiedCounts.get(railId) ?? 0;
    return current < target;
  };

  const anyRailStillNeeds = (item: VerifyQueueItem): boolean => (
    item.refs.some((ref) => railStillNeeds(ref.railId))
  );

  const applyVerifyResult = async (prepared: PreparedQueueItem): Promise<void> => {
    const { item } = prepared;
    const eligibleRefs = item.refs.filter((ref) => item.forceReprobe || railStillNeeds(ref.railId));
    if (eligibleRefs.length === 0) {
      return;
    }

    const primaryRailId = eligibleRefs[0]?.railId ?? null;
    const result = await verifyPreparedTitle(
      prepared.prepared,
      { railId: primaryRailId },
      context,
    );

    if (result.ok) {
      for (const ref of eligibleRefs) {
        const keys = railPoolKeys.get(ref.railId) ?? new Set<string>();
        await queuePoolLink(ref.railId, ref.candidate, ref.index, result.stream, context);
        if (!keys.has(item.key)) {
          keys.add(item.key);
          railPoolKeys.set(ref.railId, keys);
          railVerifiedCounts.set(ref.railId, (railVerifiedCounts.get(ref.railId) ?? 0) + 1);
        }
      }
      verified += 1;
      results.push({
        type: item.candidate.type,
        id: item.candidate.id,
        title: item.candidate.title,
        action: item.forceReprobe ? 'reverified' : 'verified',
        rails: eligibleRefs.map((ref) => ref.railId),
      });
    } else {
      failed += 1;
      results.push({
        type: item.candidate.type,
        id: item.candidate.id,
        title: item.candidate.title,
        action: 'failed',
        reason: result.reason,
        rails: eligibleRefs.map((ref) => ref.railId),
      });
    }
  };

  const scheduleProbes = () => {
    while (activeProbes.size < probeConcurrency && pendingProbes.length > 0) {
      const prepared = pendingProbes.shift();
      if (!prepared) break;
      const task = applyVerifyResult(prepared).finally(() => {
        activeProbes.delete(task);
        scheduleProbes();
      });
      activeProbes.add(task);
    }
  };

  const enqueueProbe = (prepared: PreparedQueueItem) => {
    pendingProbes.push(prepared);
    scheduleProbes();
  };

  const fillPrepareQueue = () => {
    while (
      prepareInFlight.size < resolveConcurrency
      && nextVerifyIndex < queue.length
    ) {
      const item = queue[nextVerifyIndex];
      nextVerifyIndex += 1;
      if (!item.forceReprobe && !anyRailStillNeeds(item)) {
        continue;
      }
      const queueId = nextQueueId;
      nextQueueId += 1;
      prepareInFlight.set(queueId, prepareQueueItem(queueId, item, core));
    }
  };

  fillPrepareQueue();
  while (prepareInFlight.size > 0 || pendingProbes.length > 0 || activeProbes.size > 0) {
    if (prepareInFlight.size > 0) {
      const prepared = await Promise.race(prepareInFlight.values());
      prepareInFlight.delete(prepared.queueId);
      enqueueProbe(prepared);
      fillPrepareQueue();
      continue;
    }
    if (activeProbes.size > 0) {
      await Promise.race(activeProbes);
    }
  }

  return {
    verified,
    failed,
    linked_existing: 0,
    skipped_existing: 0,
    skipped_recent_failed: 0,
    results,
  };
}

async function prepareQueueItem(
  queueId: number,
  item: VerifyQueueItem,
  core: CatalogCore,
): Promise<PreparedQueueItem> {
  return {
    queueId,
    item,
    prepared: await prepareVerifyTitle(core, item.candidate.type, item.candidate.id),
  };
}

export type BuildVerifyQueueOptions = {
  refsByKey: Map<CandidateKey, RailCandidateRef[]>;
  titleStatuses: Map<CandidateKey, TitlePlayabilityRecord>;
  railVerifiedCounts: Map<string, number>;
  railPoolTargets: Map<string, number>;
  railPoolKeys: Map<string, Set<string>>;
  staleKeys?: Set<CandidateKey>;
  now?: number;
  context?: VerifyContext;
};

export async function linkExistingVerifiedCandidates(
  options: BuildVerifyQueueOptions,
): Promise<{
  verifyQueue: VerifyQueueItem[];
  linked_existing: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  results: ProcessVerifyQueueResult['results'];
}> {
  const {
    refsByKey,
    titleStatuses,
    railVerifiedCounts,
    railPoolTargets,
    railPoolKeys,
    staleKeys = new Set(),
    now = Date.now(),
    context = {},
  } = options;

  const verifyQueue: VerifyQueueItem[] = [];
  const results: ProcessVerifyQueueResult['results'] = [];
  let linkedExisting = 0;
  let skippedExisting = 0;
  let skippedRecentFailed = 0;
  const failedRetryMs = playabilityFailedRetryMs();

  for (const [key, refs] of refsByKey.entries()) {
    const candidate = refs[0]?.candidate;
    if (!candidate) continue;

    const title = titleStatuses.get(key);
    const forceReprobe = staleKeys.has(key);

    if (
      !forceReprobe
      && title?.status === 'verified'
      && title.expires_at !== null
      && title.expires_at > now
    ) {
      let linkedForKey = false;
      for (const ref of refs) {
        const target = railPoolTargets.get(ref.railId) ?? 0;
        const current = railVerifiedCounts.get(ref.railId) ?? 0;
        if (current >= target) {
          continue;
        }
        const keys = railPoolKeys.get(ref.railId) ?? new Set<string>();
        await queuePoolLink(ref.railId, candidate, ref.index, undefined, context);
        if (keys.has(key)) {
          skippedExisting += 1;
          results.push({
            type: candidate.type,
            id: candidate.id,
            title: candidate.title,
            action: 'skipped_existing',
            rails: [ref.railId],
          });
        } else {
          keys.add(key);
          railPoolKeys.set(ref.railId, keys);
          railVerifiedCounts.set(ref.railId, current + 1);
          linkedExisting += 1;
          linkedForKey = true;
          results.push({
            type: candidate.type,
            id: candidate.id,
            title: candidate.title,
            action: 'linked_existing',
            rails: [ref.railId],
          });
        }
      }
      if (linkedForKey) {
        continue;
      }
      if (refs.every((ref) => (railVerifiedCounts.get(ref.railId) ?? 0) >= (railPoolTargets.get(ref.railId) ?? 0))) {
        continue;
      }
    }

    if (
      !forceReprobe
      && title?.status === 'failed'
      && title.updated_at > now - failedRetryMs
    ) {
      skippedRecentFailed += 1;
      results.push({
        type: candidate.type,
        id: candidate.id,
        title: candidate.title,
        action: 'skipped_recent_failed',
        rails: refs.map((ref) => ref.railId),
      });
      continue;
    }

    if (refs.some((ref) => forceReprobe || (railVerifiedCounts.get(ref.railId) ?? 0) < (railPoolTargets.get(ref.railId) ?? 0))) {
      verifyQueue.push({
        key,
        candidate,
        refs,
        forceReprobe,
      });
    }
  }

  return {
    verifyQueue,
    linked_existing: linkedExisting,
    skipped_existing: skippedExisting,
    skipped_recent_failed: skippedRecentFailed,
    results,
  };
}

export async function createVerifyContext(): Promise<VerifyContext> {
  const usePool = playabilityUseProbePool();
  if (usePool) {
    await ensureProbePool();
  }
  return {
    batchWriter: playabilityBatchDbEnabled() ? new PlayabilityBatchWriter() : null,
    useProbePool: usePool,
  };
}

export async function finalizeVerifyContext(context: VerifyContext): Promise<{ verify_count: number; pool_count: number }> {
  let flushed = { verify_count: 0, pool_count: 0 };
  if (context.batchWriter) {
    flushed = await context.batchWriter.flush();
  }
  if (context.useProbePool ?? playabilityUseProbePool()) {
    await stopProbePool();
  }
  return flushed;
}

export function railMapsFromRails(
  rails: AddonCatalogRail[],
  statuses: PlayabilityRailStatus[],
  poolTargetOverride?: number,
): {
  railVerifiedCounts: Map<string, number>;
  railPoolTargets: Map<string, number>;
} {
  const railVerifiedCounts = new Map<string, number>();
  const railPoolTargets = new Map<string, number>();
  for (const rail of rails) {
    const status = statuses.find((entry) => entry.rail_id === rail.id);
    railVerifiedCounts.set(rail.id, status?.verified_pool ?? 0);
    railPoolTargets.set(
      rail.id,
      poolTargetOverride ?? rail.playability.pool_target,
    );
  }
  return { railVerifiedCounts, railPoolTargets };
}

import type { CatalogCore } from '../core.js';
import type { CandidateMeta } from './list-source.js';
import {
  getRailPlayabilityStatus,
  getRailPoolTitleKeys,
  getTitlePlayability,
  upsertRailPoolTitle,
  type PlayabilityRailStatus,
} from './db.js';
import {
  prepareVerifyTitle,
  verifyPreparedTitle,
  type PreparedVerifyTitleResult,
} from './verify.js';

const FAILED_RETRY_MS = Number(process.env.MANGO_PLAYABILITY_FAILED_RETRY_MS || 24 * 60 * 60 * 1000);
const RESOLVE_CONCURRENCY = Math.max(1, Number(process.env.MANGO_PLAYABILITY_RESOLVE_CONCURRENCY || 3) || 3);

export type TopUpRailResult = {
  rail_id: string;
  label: string;
  ok: boolean;
  candidate_limit: number;
  pool_target: number;
  min_display: number;
  before: PlayabilityRailStatus;
  after: PlayabilityRailStatus;
  candidates_seen: number;
  linked_existing: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  exhausted: boolean;
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: 'linked_existing' | 'verified' | 'failed' | 'skipped_existing' | 'skipped_recent_failed';
    reason?: string;
  }>;
};

type VerifyQueueItem = {
  index: number;
  candidate: CandidateMeta;
};

type PreparedQueueItem = VerifyQueueItem & {
  queueId: number;
  prepared: PreparedVerifyTitleResult;
};

export type TopUpRailOptions = {
  poolTarget?: number;
  candidateLimit?: number;
};

function candidateKey(candidate: CandidateMeta): string {
  return `${candidate.type}:${candidate.id}`;
}

function valueAsString(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function scoreForCandidate(index: number, stream?: Record<string, unknown>): number {
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

function uniqueCandidates(candidates: CandidateMeta[]): CandidateMeta[] {
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

async function prepareQueueItem(
  queueId: number,
  item: VerifyQueueItem,
  core: CatalogCore,
): Promise<PreparedQueueItem> {
  return {
    ...item,
    queueId,
    prepared: await prepareVerifyTitle(core, item.candidate.type, item.candidate.id),
  };
}

export async function topUpRail(
  core: CatalogCore,
  railId: string,
  options: TopUpRailOptions = {},
): Promise<TopUpRailResult> {
  const rail = core.addonRail(railId);
  const source = core.listSourceForRail(railId);
  const candidateLimit = options.candidateLimit ?? rail.limit * rail.playability.ingest_multiplier;
  const poolTarget = options.poolTarget ?? rail.playability.pool_target;
  const before = await getRailPlayabilityStatus(rail.id);
  if (before.verified_pool >= poolTarget) {
    return {
      rail_id: rail.id,
      label: rail.label,
      ok: before.verified_pool >= rail.playability.min_display,
      candidate_limit: candidateLimit,
      pool_target: poolTarget,
      min_display: rail.playability.min_display,
      before,
      after: before,
      candidates_seen: 0,
      linked_existing: 0,
      verified: 0,
      failed: 0,
      skipped_existing: 0,
      skipped_recent_failed: 0,
      exhausted: false,
      results: [],
    };
  }
  const poolKeys = await getRailPoolTitleKeys(rail.id);
  let verifiedPool = before.verified_pool;
  const candidates = uniqueCandidates(await source.candidates({ offset: 0, limit: candidateLimit }));
  const results: TopUpRailResult['results'] = [];
  const verifyQueue: VerifyQueueItem[] = [];
  let linkedExisting = 0;
  let verified = 0;
  let failed = 0;
  let skippedExisting = 0;
  let skippedRecentFailed = 0;
  const now = Date.now();

  for (const [index, candidate] of candidates.entries()) {
    if (verifiedPool >= poolTarget) {
      break;
    }

    const key = candidateKey(candidate);
    const title = await getTitlePlayability(candidate.type, candidate.id);

    if (title?.status === 'verified' && title.expires_at !== null && title.expires_at > now) {
      await upsertRailPoolTitle({
        rail_id: rail.id,
        type: candidate.type,
        id: candidate.id,
        score: scoreForCandidate(index),
      });
      if (poolKeys.has(key)) {
        skippedExisting += 1;
        results.push({
          type: candidate.type,
          id: candidate.id,
          title: candidate.title,
          action: 'skipped_existing',
        });
      } else {
        poolKeys.add(key);
        verifiedPool += 1;
        linkedExisting += 1;
        results.push({
          type: candidate.type,
          id: candidate.id,
          title: candidate.title,
          action: 'linked_existing',
        });
      }
      continue;
    }

    if (title?.status === 'failed' && title.updated_at > now - FAILED_RETRY_MS) {
      skippedRecentFailed += 1;
      results.push({
        type: candidate.type,
        id: candidate.id,
        title: candidate.title,
        action: 'skipped_recent_failed',
      });
      continue;
    }

    verifyQueue.push({ index, candidate });
  }

  let nextVerifyIndex = 0;
  let nextQueueId = 0;
  const inFlight = new Map<number, Promise<PreparedQueueItem>>();
  const fillResolveQueue = () => {
    while (
      inFlight.size < RESOLVE_CONCURRENCY
      && nextVerifyIndex < verifyQueue.length
      && verifiedPool < poolTarget
    ) {
      const queueId = nextQueueId;
      nextQueueId += 1;
      const item = verifyQueue[nextVerifyIndex];
      nextVerifyIndex += 1;
      inFlight.set(queueId, prepareQueueItem(queueId, item, core));
    }
  };

  fillResolveQueue();
  while (inFlight.size > 0 && verifiedPool < poolTarget) {
    const prepared = await Promise.race(inFlight.values());
    inFlight.delete(prepared.queueId);
    fillResolveQueue();

    const result = await verifyPreparedTitle(prepared.prepared, { railId: rail.id });
    if (result.ok) {
      await upsertRailPoolTitle({
        rail_id: rail.id,
        type: prepared.candidate.type,
        id: prepared.candidate.id,
        score: scoreForCandidate(prepared.index, result.stream),
      });
      const key = candidateKey(prepared.candidate);
      if (!poolKeys.has(key)) {
        poolKeys.add(key);
        verifiedPool += 1;
      }
      verified += 1;
      results.push({
        type: prepared.candidate.type,
        id: prepared.candidate.id,
        title: prepared.candidate.title,
        action: 'verified',
      });
    } else {
      failed += 1;
      results.push({
        type: prepared.candidate.type,
        id: prepared.candidate.id,
        title: prepared.candidate.title,
        action: 'failed',
        reason: result.reason,
      });
    }
    fillResolveQueue();
  }

  const after = await getRailPlayabilityStatus(rail.id);
  return {
    rail_id: rail.id,
    label: rail.label,
    ok: after.verified_pool >= rail.playability.min_display,
    candidate_limit: candidateLimit,
    pool_target: poolTarget,
    min_display: rail.playability.min_display,
    before,
    after,
    candidates_seen: candidates.length,
    linked_existing: linkedExisting,
    verified,
    failed,
    skipped_existing: skippedExisting,
    skipped_recent_failed: skippedRecentFailed,
    exhausted: after.verified_pool < poolTarget,
    results,
  };
}

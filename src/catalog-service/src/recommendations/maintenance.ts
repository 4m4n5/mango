import {
  closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isCouchIdleForTriggerConsumer } from '../playability/trigger-consumer.js';

export const RECOMMENDATION_MAINTENANCE_LEASE_STALE_MS = 30_000;
export const RECOMMENDATION_MAINTENANCE_DEADLINE_MS = 15 * 60_000;

export type RecommendationMemorySnapshot = {
  rss: number;
  heap_used: number;
  heap_total: number;
  external: number;
  array_buffers: number;
  captured_at: number;
};

export type RecommendationMaintenanceLeaseRecord = {
  owner: string;
  pid: number;
  started_at: number;
  heartbeat_at: number;
  deadline_at: number;
  phase: string;
  cursor: string | null;
};

export class CouchPreemptedRecommendationRefreshError extends Error {
  readonly code = 'couch_preempted';

  constructor(message = 'recommendation refresh yielded to couch activity') {
    super(message);
    this.name = 'CouchPreemptedRecommendationRefreshError';
  }
}

export class RecommendationRefreshDeadlineError extends Error {
  readonly code = 'refresh_deadline_exceeded';

  constructor() {
    super('recommendation refresh exceeded its 15-minute execution deadline');
    this.name = 'RecommendationRefreshDeadlineError';
  }
}

export function recommendationMaintenanceLeasePath(): string {
  const cache = process.env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache');
  return process.env.MANGO_RECOMMENDATION_MAINTENANCE_LEASE?.trim()
    || join(cache, 'mango', 'recommendation-maintenance.lease');
}

export function recommendationMemorySnapshot(now = Date.now()): RecommendationMemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heap_used: usage.heapUsed,
    heap_total: usage.heapTotal,
    external: usage.external,
    array_buffers: usage.arrayBuffers,
    captured_at: now,
  };
}

export function readFreshRecommendationMaintenanceLease(
  now = Date.now(),
): RecommendationMaintenanceLeaseRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(recommendationMaintenanceLeasePath(), 'utf8'),
    ) as RecommendationMaintenanceLeaseRecord;
    if (!Number.isFinite(parsed.heartbeat_at)
      || now - parsed.heartbeat_at > RECOMMENDATION_MAINTENANCE_LEASE_STALE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type RecommendationMaintenanceLease = {
  path: string;
  started_at: number;
  deadline_at: number;
  checkpoint(phase: string, cursor?: string | null): RecommendationMemorySnapshot;
  release(): void;
};

export function acquireRecommendationMaintenanceLease(input: {
  owner: string;
  now?: number;
  ignoreCouch?: boolean;
}): RecommendationMaintenanceLease {
  const now = input.now ?? Date.now();
  if (!input.ignoreCouch && !isCouchIdleForTriggerConsumer(now)) {
    throw new CouchPreemptedRecommendationRefreshError('couch is active; heavy refresh was not started');
  }
  const path = recommendationMaintenanceLeasePath();
  mkdirSync(dirname(path), { recursive: true });
  let descriptor: number;
  try {
    descriptor = openSync(path, 'wx', 0o600);
  } catch {
    const fresh = readFreshRecommendationMaintenanceLease(now);
    if (fresh) throw new Error(`recommendation maintenance already active: ${fresh.owner}`);
    try { unlinkSync(path); } catch { /* stale lease may already be gone */ }
    descriptor = openSync(path, 'wx', 0o600);
  }
  closeSync(descriptor);
  const deadlineAt = now + RECOMMENDATION_MAINTENANCE_DEADLINE_MS;
  let released = false;
  const checkpoint = (phase: string, cursor: string | null = null): RecommendationMemorySnapshot => {
    if (released) throw new Error('recommendation maintenance lease is released');
    const checkpointNow = Date.now();
    if (checkpointNow > deadlineAt) throw new RecommendationRefreshDeadlineError();
    const record: RecommendationMaintenanceLeaseRecord = {
      owner: input.owner,
      pid: process.pid,
      started_at: now,
      heartbeat_at: checkpointNow,
      deadline_at: deadlineAt,
      phase,
      cursor,
    };
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporaryPath, path);
    if (!input.ignoreCouch && !isCouchIdleForTriggerConsumer(checkpointNow)) {
      throw new CouchPreemptedRecommendationRefreshError();
    }
    return recommendationMemorySnapshot(checkpointNow);
  };
  checkpoint('acquired');
  return {
    path,
    started_at: now,
    deadline_at: deadlineAt,
    checkpoint,
    release: () => {
      if (released) return;
      released = true;
      try { unlinkSync(path); } catch { /* idempotent release */ }
    },
  };
}

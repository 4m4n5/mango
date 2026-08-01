import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type CachedLiveRailsPayload = {
  tab: 'live';
  rails: unknown[];
  resolve_ms?: number;
  cached?: boolean;
  stale?: boolean;
};

type LiveRailsDiskCache = {
  policy_version?: number;
  saved_at: number;
  expires_at: number;
  payload: CachedLiveRailsPayload;
};

export type LiveRailsRefreshStatus = {
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
};

export type LiveRailsBackgroundRefreshDecision = {
  refresh: boolean;
  reason: 'config_unavailable' | 'cache_fresh' | 'playback_active' | 'in_flight' | 'rate_limited' | 'stale';
};

/** Bump when cached rail membership semantics change incompatibly. */
export const LIVE_RAILS_POLICY_VERSION = 4;

export function liveRailsDiskCacheCompatible(
  entry: LiveRailsDiskCache | null,
): entry is LiveRailsDiskCache {
  return entry !== null && entry.policy_version === LIVE_RAILS_POLICY_VERSION;
}

export function liveRailsCachePath(): string {
  return process.env.MANGO_LIVE_RAILS_CACHE
    || join(homedir(), '.cache/mango/live-rails-cache.json');
}

export function liveRailsRefreshStatusPath(): string {
  return process.env.MANGO_LIVE_RAILS_REFRESH_STATUS
    || `${liveRailsCachePath()}.status.json`;
}

export function readLiveRailsRefreshStatusSync(): LiveRailsRefreshStatus {
  try {
    const parsed = JSON.parse(readFileSync(liveRailsRefreshStatusPath(), 'utf8')) as Partial<LiveRailsRefreshStatus>;
    return {
      last_attempt_at: typeof parsed.last_attempt_at === 'number' ? parsed.last_attempt_at : null,
      last_success_at: typeof parsed.last_success_at === 'number' ? parsed.last_success_at : null,
      last_error: typeof parsed.last_error === 'string' ? parsed.last_error : null,
    };
  } catch {
    return { last_attempt_at: null, last_success_at: null, last_error: null };
  }
}

export async function writeLiveRailsRefreshStatus(status: LiveRailsRefreshStatus): Promise<void> {
  const path = liveRailsRefreshStatusPath();
  const temp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, JSON.stringify(status), 'utf8');
  await rename(temp, path);
}

export function liveRailsBackgroundRefreshDecision(input: {
  configReady: boolean;
  cacheFresh: boolean;
  playbackActive: boolean;
  inFlight: boolean;
  lastAttemptAt: number | null;
  now: number;
  minAttemptIntervalMs: number;
}): LiveRailsBackgroundRefreshDecision {
  if (!input.configReady) return { refresh: false, reason: 'config_unavailable' };
  if (input.cacheFresh) return { refresh: false, reason: 'cache_fresh' };
  if (input.playbackActive) return { refresh: false, reason: 'playback_active' };
  if (input.inFlight) return { refresh: false, reason: 'in_flight' };
  if (input.lastAttemptAt !== null && input.now - input.lastAttemptAt < input.minAttemptIntervalMs) {
    return { refresh: false, reason: 'rate_limited' };
  }
  return { refresh: true, reason: 'stale' };
}

export async function readLiveRailsDiskCache(): Promise<LiveRailsDiskCache | null> {
  try {
    const raw = await readFile(liveRailsCachePath(), 'utf8');
    const parsed = JSON.parse(raw) as LiveRailsDiskCache;
    if (!parsed?.payload || !Array.isArray(parsed.payload.rails)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readLiveRailsDiskCacheSync(): LiveRailsDiskCache | null {
  try {
    const raw = readFileSync(liveRailsCachePath(), 'utf8');
    const parsed = JSON.parse(raw) as LiveRailsDiskCache;
    if (!parsed?.payload || !Array.isArray(parsed.payload.rails)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function liveRailsCacheGeneration(): number {
  return readLiveRailsDiskCacheSync()?.saved_at ?? 0;
}

export async function writeLiveRailsDiskCache(
  payload: CachedLiveRailsPayload,
  ttlSec: number,
): Promise<void> {
  const now = Date.now();
  const entry: LiveRailsDiskCache = {
    policy_version: LIVE_RAILS_POLICY_VERSION,
    saved_at: now,
    expires_at: now + ttlSec * 1000,
    payload,
  };
  const path = liveRailsCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entry), 'utf8');
}

export function liveRailsDiskCacheFresh(
  entry: LiveRailsDiskCache | null,
): entry is LiveRailsDiskCache {
  return liveRailsDiskCacheCompatible(entry)
    && entry.expires_at > Date.now()
    && entry.payload.rails.length > 0;
}

export function liveRailsDiskCacheNonEmpty(
  entry: LiveRailsDiskCache | null,
): entry is LiveRailsDiskCache {
  return liveRailsDiskCacheCompatible(entry) && entry.payload.rails.length > 0;
}

export function liveRailsDiskCacheSummary(entry: LiveRailsDiskCache | null): {
  path: string;
  present: boolean;
  compatible: boolean;
  non_empty: boolean;
  fresh: boolean;
  age_sec: number | null;
  expires_in_sec: number | null;
  rail_counts: Record<string, number>;
} {
  const now = Date.now();
  const railCounts: Record<string, number> = {};
  for (const rail of entry?.payload.rails ?? []) {
    const row = rail as { rail_id?: unknown; id?: unknown; items?: unknown };
    const id = typeof row.rail_id === 'string'
      ? row.rail_id
      : typeof row.id === 'string'
        ? row.id
        : 'unknown';
    railCounts[id] = Array.isArray(row.items) ? row.items.length : 0;
  }
  return {
    path: liveRailsCachePath(),
    present: entry !== null,
    compatible: liveRailsDiskCacheCompatible(entry),
    non_empty: liveRailsDiskCacheNonEmpty(entry),
    fresh: liveRailsDiskCacheFresh(entry),
    age_sec: entry ? Math.max(0, Math.round((now - entry.saved_at) / 1000)) : null,
    expires_in_sec: entry ? Math.round((entry.expires_at - now) / 1000) : null,
    rail_counts: railCounts,
  };
}

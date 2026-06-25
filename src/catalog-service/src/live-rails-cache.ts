import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  saved_at: number;
  expires_at: number;
  payload: CachedLiveRailsPayload;
};

export function liveRailsCachePath(): string {
  return process.env.MANGO_LIVE_RAILS_CACHE
    || join(homedir(), '.cache/mango/live-rails-cache.json');
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

export async function writeLiveRailsDiskCache(
  payload: CachedLiveRailsPayload,
  ttlSec: number,
): Promise<void> {
  const now = Date.now();
  const entry: LiveRailsDiskCache = {
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
  return entry !== null && entry.expires_at > Date.now() && entry.payload.rails.length > 0;
}

export function liveRailsDiskCacheNonEmpty(
  entry: LiveRailsDiskCache | null,
): entry is LiveRailsDiskCache {
  return entry !== null && entry.payload.rails.length > 0;
}

export function liveRailsDiskCacheSummary(entry: LiveRailsDiskCache | null): {
  path: string;
  present: boolean;
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
    non_empty: liveRailsDiskCacheNonEmpty(entry),
    fresh: liveRailsDiskCacheFresh(entry),
    age_sec: entry ? Math.max(0, Math.round((now - entry.saved_at) / 1000)) : null,
    expires_in_sec: entry ? Math.round((entry.expires_at - now) / 1000) : null,
    rail_counts: railCounts,
  };
}

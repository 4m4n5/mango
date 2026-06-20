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

function cachePath(): string {
  return process.env.MANGO_LIVE_RAILS_CACHE
    || join(homedir(), '.cache/mango/live-rails-cache.json');
}

export async function readLiveRailsDiskCache(): Promise<LiveRailsDiskCache | null> {
  try {
    const raw = await readFile(cachePath(), 'utf8');
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
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(entry), 'utf8');
}

export function liveRailsDiskCacheFresh(
  entry: LiveRailsDiskCache | null,
): entry is LiveRailsDiskCache {
  return entry !== null && entry.expires_at > Date.now() && entry.payload.rails.length > 0;
}

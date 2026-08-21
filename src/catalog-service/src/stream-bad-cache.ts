/**
 * Session-scoped cache of proven-bad stream URLs (copyright / status clip / NFO).
 * Keyed by streamUrlHash so we never retry the same garbage URL within TTL,
 * without blacklisting an entire title (alternate releases stay eligible).
 *
 * Transient failures (preflight timeout, debrid_playback_unreadable) are NOT
 * cached — thin titles with one stream must remain retryable.
 */

import { isGarbagePlayError } from './play-error-classify.js';

const DEFAULT_TTL_MS = Number(process.env.MANGO_STREAM_BAD_CACHE_MS || 45 * 60 * 1000);

const badUntilByHash = new Map<string, number>();

export function isBadStreamError(error: unknown): boolean {
  if (typeof error !== 'string') {
    return false;
  }
  return isGarbagePlayError(error);
}

export function markStreamUrlBad(urlHash: string, ttlMs = DEFAULT_TTL_MS): void {
  if (!urlHash) {
    return;
  }
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  badUntilByHash.set(urlHash, Date.now() + ttl);
}

export function isStreamUrlBad(urlHash: string, nowMs = Date.now()): boolean {
  if (!urlHash) {
    return false;
  }
  const until = badUntilByHash.get(urlHash);
  if (until === undefined) {
    return false;
  }
  if (until <= nowMs) {
    badUntilByHash.delete(urlHash);
    return false;
  }
  return true;
}

/** Test / restart helper — clears the in-process map. */
export function clearStreamBadCache(): void {
  badUntilByHash.clear();
}

export function streamBadCacheSize(): number {
  return badUntilByHash.size;
}

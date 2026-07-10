/**
 * Single source of truth for "what kind of play failure is this?"
 * Consumers: bad-cache, thin-retry, demotion policy, couch copy, verify failReason.
 */

export type PlayErrorClass =
  | 'garbage' // NFO / copyright / status-clip — bad-cache these URLs
  | 'transient' // timeout / network / unreadable / budget — retryable, do not demote as confirmed
  | 'rate_limited'
  | 'no_stream'
  | 'cancelled'
  | 'unknown';

/** Finer kind within garbage — for couch copy / verify reason strings. */
export type GarbageKind = 'nfo' | 'copyright' | 'status_clip';

const CANCELLED_RE = /play cancelled|play epoch|PlayCancelledError/i;
const GARBAGE_RE = /debrid_copyright_block|debrid_status_clip|debrid_nfo_sidecar/i;
/** Message-only — never bare `429` (opaque debrid/MF URL tokens often contain those digits). */
const RATE_LIMIT_RE =
  /rate[-\s]*limit|too many requests|ratelimit_error|please wait|HTTP\s*429|\b429\b[^\n]{0,40}(?:too many|rate|request|limit)|(?:too many|rate[-\s]*limit)[^\n]{0,40}\b429\b/i;
/** Path markers on addon placeholder URLs — not digit substrings in tokens. */
const RATE_LIMIT_URL_RE = /rate-limit-exceeded|public-rate-limit/i;
const NO_STREAM_RE = /no_playable_stream|no streams|no http streams|no_stream/i;
const TRANSIENT_RE =
  /debrid_playback_unreadable|timeout|timed out|vo not ready|did not start playback|play budget exhausted|ECONN|ENOTFOUND|socket|abort|HTTP 5\d\d|fetch failed|supplemental_or_short_release|no error detail captured|stream_url_bad_cached/i;

const NFO_RE = /debrid_nfo_sidecar/i;
const COPYRIGHT_RE = /debrid_copyright_block/i;
const STATUS_CLIP_RE = /debrid_status_clip/i;

/** True when a stream URL is an addon rate-limit placeholder (path markers only). */
export function isRateLimitPlaceholderUrl(url: string): boolean {
  return Boolean(url) && RATE_LIMIT_URL_RE.test(url);
}

/** First match wins — order is part of the contract. */
export function classifyPlayError(message: string): PlayErrorClass {
  if (!message) return 'unknown';
  if (CANCELLED_RE.test(message)) return 'cancelled';
  if (GARBAGE_RE.test(message)) return 'garbage';
  if (RATE_LIMIT_URL_RE.test(message) || RATE_LIMIT_RE.test(message)) return 'rate_limited';
  if (NO_STREAM_RE.test(message)) return 'no_stream';
  if (TRANSIENT_RE.test(message)) return 'transient';
  return 'unknown';
}

export function isGarbagePlayError(message: string): boolean {
  return classifyPlayError(message) === 'garbage';
}

export function isTransientPlayError(message: string): boolean {
  return classifyPlayError(message) === 'transient';
}

/** Differentiate garbage codes for couch UI / verify reason mapping. */
export function garbageKind(message: string): GarbageKind | null {
  if (!message) return null;
  if (NFO_RE.test(message)) return 'nfo';
  if (COPYRIGHT_RE.test(message)) return 'copyright';
  if (STATUS_CLIP_RE.test(message)) return 'status_clip';
  return null;
}

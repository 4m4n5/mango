/** Couch-safe catalog copy for launcher — mirrors catalog-service policy. */

const RATE_LIMIT_RE =
  /rate\s*limit|too many requests|ratelimit_error|please wait|http\s*429|\b429\b[^\n]{0,40}(?:too many|rate|request|limit)|(?:too many|rate\s*limit)[^\n]{0,40}\b429\b/i;
const RATE_LIMIT_URL_RE = /rate-limit-exceeded|public-rate-limit/i;
const RAW_INFRA_RE = /HTTP\s*[45]\d\d|fetch failed|ECONN|socket|AIOStreams:|Cinemeta:/i;

/**
 * Browse/meta sanitizer — collapses raw addon/infra text.
 * Play endpoints should use {@link playErrorMessage} instead (server already couch-safe).
 */
export function couchSafeCatalogMessage(message: string): string {
  const lower = message.toLowerCase();
  if (RATE_LIMIT_URL_RE.test(lower) || RATE_LIMIT_RE.test(lower)) {
    return 'catalog is busy — try again in a moment';
  }
  if (lower.includes('youtube')) {
    return message;
  }
  if (lower.includes('temporarily unavailable') || lower.includes('timed out')) {
    return message;
  }
  if (lower.includes('http 5') || lower.includes('http 429')) {
    return 'catalog temporarily unavailable';
  }
  return 'catalog temporarily unavailable';
}

/**
 * Play-path error: trust server couchMessage when present.
 * Only re-sanitize when the payload looks like raw infra text.
 */
export function playErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return 'catalog temporarily unavailable';
  }
  if (RAW_INFRA_RE.test(trimmed)) {
    return couchSafeCatalogMessage(trimmed);
  }
  return trimmed;
}

export function playTimeoutMessage(): string {
  return 'catalog timed out — try again';
}

export type CatalogAvailabilityReason = 'busy' | 'timeout' | 'unavailable';

export function catalogAvailabilityReason(error: unknown): CatalogAvailabilityReason {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (RATE_LIMIT_URL_RE.test(message) || RATE_LIMIT_RE.test(message) || /\bbusy\b/i.test(message)) {
    return 'busy';
  }
  if (/timed? out|timeout/i.test(message)) {
    return 'timeout';
  }
  return 'unavailable';
}

export class CatalogTimeoutError extends Error {
  constructor() {
    super(playTimeoutMessage());
    this.name = 'CatalogTimeoutError';
  }
}

export class PlayTimeoutError extends Error {
  constructor(readonly requestAlreadyFinished = false) {
    super(playTimeoutMessage());
    this.name = 'PlayTimeoutError';
  }
}

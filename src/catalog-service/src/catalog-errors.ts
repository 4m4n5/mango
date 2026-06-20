/** Couch-safe catalog errors — never surface raw addon host messages on TV. */

const RATE_LIMIT_RE = /rate\s*limit|too many requests|429|ratelimit_error|please wait/i;
const RATE_LIMIT_URL_RE = /rate-limit-exceeded|public-rate-limit/i;

/** True when addon text must never appear as a browse title or description. */
export function isBlockedCatalogText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return RATE_LIMIT_RE.test(trimmed);
}

type CatalogMetaLike = {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  description?: unknown;
};

/** AIOMetadata/TMDB throttles sometimes return error metas with human-readable limit copy. */
export function isBlockedCatalogMeta(meta: CatalogMetaLike): boolean {
  const fields = [meta.id, meta.name, meta.title, meta.description];
  for (const value of fields) {
    if (typeof value === 'string' && isBlockedCatalogText(value)) {
      return true;
    }
  }
  return false;
}

export function isAddonRateLimitMessage(message: string): boolean {
  return RATE_LIMIT_RE.test(message);
}

/** AIOStreams returns this placeholder when ElfHosted public instances are throttled. */
export function isRateLimitedStreamUrl(url: string): boolean {
  return RATE_LIMIT_URL_RE.test(url);
}

export function isElfHostedAddonName(name: string): boolean {
  return /elfhosted/i.test(name);
}

export function couchPlayFailureMessage(attempts: Array<{ error?: string }> | undefined): string {
  const errors = (attempts || []).map((attempt) => attempt.error || '').join(' ');
  if (/debrid_nfo_sidecar|debrid_playback_unreadable/i.test(errors)) {
    return 'stream not ready on TorBox — try again in a few minutes';
  }
  if (/supplemental_or_short_release/i.test(errors)) {
    return 'no full-length stream found — try another option';
  }
  if (/debrid_status_clip/i.test(errors)) {
    return 'stream still caching on TorBox — try again in a few minutes';
  }
  return 'catalog temporarily unavailable';
}

export function couchSafeCatalogMessage(message: string, context?: { addon?: string }): string {
  if (isAddonRateLimitMessage(message)) {
    if (context?.addon && isElfHostedAddonName(context.addon)) {
      return 'catalog is refreshing — try again in a moment';
    }
    return 'catalog is busy — try again in a moment';
  }
  if (/HTTP 5\d\d/i.test(message) || /HTTP 429/i.test(message)) {
    return 'catalog temporarily unavailable';
  }
  if (/abort/i.test(message) || /timeout/i.test(message)) {
    return 'catalog timed out — try again';
  }
  return 'catalog temporarily unavailable';
}

export class CatalogError extends Error {
  status: number;
  details?: Record<string, unknown>;
  couchMessage: string;

  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
    options?: { couchMessage?: string },
  ) {
    super(message);
    this.status = status;
    this.details = details;
    this.couchMessage = options?.couchMessage ?? couchSafeCatalogMessage(message);
  }
}

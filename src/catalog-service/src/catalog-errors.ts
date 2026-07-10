/** Couch-safe catalog errors — never surface raw addon host messages on TV. */

import {
  classifyPlayError,
  garbageKind,
} from './play-error-classify.js';

/** True when addon text must never appear as a browse title or description. */
export function isBlockedCatalogText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return classifyPlayError(trimmed) === 'rate_limited';
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
  return classifyPlayError(message) === 'rate_limited';
}

/** AIOStreams may return this placeholder URL when upstream APIs are throttled. */
export function isRateLimitedStreamUrl(url: string): boolean {
  return classifyPlayError(url) === 'rate_limited';
}

type CouchPlayFailureAttempt = {
  error?: string;
  debrid_service?: unknown;
};

type CouchPlayFailureContext = {
  candidates?: number;
};

function normalizeDebridService(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

/** NFO sidecar or unreadable — couch copy historically grouped these. */
function isNfoLikeError(error: string): boolean {
  return garbageKind(error) === 'nfo' || /debrid_playback_unreadable/i.test(error);
}

/**
 * Errors that previously mapped to the "streams are still preparing" bucket
 * (garbage codes + unreadable + bad-cached URL).
 */
function isCouchPreparingError(error: string): boolean {
  if (garbageKind(error)) return true;
  return /debrid_playback_unreadable|stream_url_bad_cached/i.test(error);
}

export function couchPlayFailureMessage(
  attempts: CouchPlayFailureAttempt[] | undefined,
  context: CouchPlayFailureContext = {},
): string {
  const list = attempts || [];
  if (context.candidates === 0 || list.length === 0) {
    return 'no streams found for this title';
  }
  const errors = list.map((attempt) => attempt.error || '').join(' ');
  const services = new Set(
    list
      .map((attempt) => normalizeDebridService(attempt.debrid_service))
      .filter((service): service is string => Boolean(service)),
  );
  const triedTorbox = [...services].some((service) => service.includes('torbox'));
  const triedRealDebrid = [...services].some((service) => service.includes('real') || service === 'rd');
  const triedBothPrimaryDebrid = triedTorbox && triedRealDebrid;
  const attemptErrors = list.map((attempt) => attempt.error).filter((value): value is string => Boolean(value));
  const allTorboxNfo = attemptErrors.length > 0 && attemptErrors.every((error) => isNfoLikeError(error));
  const hasTorboxNfo = attemptErrors.some((error) => isNfoLikeError(error));
  const allPreparing = attemptErrors.length > 0 && attemptErrors.every((error) => isCouchPreparingError(error));
  if (triedTorbox && !triedRealDebrid && allTorboxNfo) {
    return 'stream not ready on TorBox — try again in a few minutes';
  }
  if (triedBothPrimaryDebrid) {
    return "couldn't find a ready stream right now — try again in a few minutes";
  }
  if (allPreparing) {
    return 'streams are still preparing — try again in a few minutes';
  }
  if (hasTorboxNfo && !triedRealDebrid) {
    return 'stream not ready on TorBox — try again in a few minutes';
  }
  if (!errors.trim()) {
    return 'no streams found for this title';
  }

  const kind = garbageKind(errors);
  if (kind === 'copyright' || /copyright infringement|removed from.*debrid/i.test(errors)) {
    return 'streams are still preparing — try again in a few minutes';
  }
  if (kind === 'nfo' || /debrid_playback_unreadable/i.test(errors)) {
    return 'stream not ready on TorBox — try again in a few minutes';
  }
  if (classifyPlayError(errors) === 'transient' && /supplemental_or_short_release/i.test(errors)) {
    return 'no full-length stream found — try another option';
  }
  if (kind === 'status_clip' || /stream_url_bad_cached/i.test(errors)) {
    return 'streams are still preparing — try again in a few minutes';
  }
  return 'stream did not start — try another option';
}

export function couchSafeCatalogMessage(message: string): string {
  const cls = classifyPlayError(message);
  if (cls === 'rate_limited') {
    return 'catalog is busy — try again in a moment';
  }
  if (/HTTP 5\d\d/i.test(message) || /HTTP 429/i.test(message) || /fetch failed|ECONN|socket/i.test(message)) {
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

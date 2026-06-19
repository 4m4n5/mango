/** Couch-safe catalog errors — never surface raw addon host messages on TV. */

const RATE_LIMIT_RE = /rate\s*limit|too many requests|429/i;

export function isAddonRateLimitMessage(message: string): boolean {
  return RATE_LIMIT_RE.test(message);
}

export function isElfHostedAddonName(name: string): boolean {
  return /elfhosted/i.test(name);
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

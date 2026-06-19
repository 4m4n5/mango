/** Couch-safe catalog copy for launcher — mirrors catalog-service policy. */

const RATE_LIMIT_RE = /rate\s*limit|too many requests|429/i;

export function couchSafeCatalogMessage(message: string): string {
  const lower = message.toLowerCase();
  if (RATE_LIMIT_RE.test(lower) || lower.includes('elfhosted')) {
    return 'catalog is refreshing — try again in a moment';
  }
  if (lower.includes('temporarily unavailable') || lower.includes('timed out')) {
    return message;
  }
  if (lower.includes('http 5') || lower.includes('http 429')) {
    return 'catalog temporarily unavailable';
  }
  return 'catalog unavailable';
}

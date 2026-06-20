import type { Meta } from './core.js';

/** Normalize poster/artwork URLs for launcher `<img src>`. */
export function normalizePosterUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:\/\//i, 'https://');
  return null;
}

/** Best-effort poster from meta + catalog preview (poster → background → logo). */
export function resolvePosterFromMeta(meta: Meta, preview?: unknown): string | null {
  const previewPoster = typeof preview === 'object' && preview !== null
    ? (preview as { poster?: unknown }).poster
    : undefined;

  for (const candidate of [meta.poster, meta.background, meta.logo, previewPoster]) {
    const url = normalizePosterUrl(candidate);
    if (url) return url;
  }
  return null;
}

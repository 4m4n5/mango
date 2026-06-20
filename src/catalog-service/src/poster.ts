import type { Meta } from './core.js';

/** Bare IMDB id from Cinemeta ids (`tt123` or `tt123:1:1`). */
export function imdbBareId(id: string): string | null {
  const bare = id.trim().split(':')[0];
  return bare && /^tt\d+$/i.test(bare) ? bare : null;
}

/** Cinemeta image CDN — avoids a meta round-trip when poster is missing from meta. */
export function metahubPosterUrl(id: string, size: 'medium' | 'large' = 'medium'): string | null {
  const bare = imdbBareId(id);
  if (!bare) return null;
  return `https://images.metahub.space/poster/${size}/${bare}/img`;
}

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
  const metaId = typeof meta.id === 'string' ? meta.id : null;
  return metaId ? metahubPosterUrl(metaId) : null;
}

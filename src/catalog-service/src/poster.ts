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

/** Stable YouTube video thumbnail that does not spend Data API quota. */
export function youtubeVideoThumbnailUrl(id: string): string | null {
  const normalized = id.trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(normalized)) return null;
  return `https://i.ytimg.com/vi/${normalized}/hqdefault.jpg`;
}

const FRAGILE_YTIMG = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\/(maxresdefault|sddefault|mqdefault)(?:\.(?:jpg|webp))?(?:[?#].*)?$/i;

/** maxres/sd/mq ytimg URLs 404 for many videos; hqdefault is the reliable couch size. */
export function rewriteFragileYoutubeThumbnail(url: string): string | null {
  const match = url.trim().match(FRAGILE_YTIMG);
  return match ? youtubeVideoThumbnailUrl(match[1]!) : null;
}

/** Best launcher URL for a YouTube video card, including watch stubs with no API artwork. */
export function youtubeCardThumbnailUrl(
  id: string,
  stored?: string | null,
  kind?: string | null,
): string | null {
  if (kind && kind !== 'video') {
    return normalizePosterUrl(stored);
  }
  const storedUrl = normalizePosterUrl(stored);
  if (storedUrl) {
    return rewriteFragileYoutubeThumbnail(storedUrl) ?? storedUrl;
  }
  return youtubeVideoThumbnailUrl(id);
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

function metaYear(meta: Meta): number | string | undefined {
  if (meta.year !== undefined && meta.year !== null) {
    return meta.year as number | string;
  }
  const released = typeof meta.released === 'string' ? meta.released : '';
  const match = released.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}

function metaTitle(meta: Meta, fallbackId: string): string {
  if (typeof meta.name === 'string' && meta.name.trim()) {
    return meta.name.trim();
  }
  if (typeof meta.title === 'string' && meta.title.trim()) {
    return meta.title.trim();
  }
  return fallbackId;
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

/** Launcher-facing meta — always includes best-effort poster + display title. */
export function enrichMetaForLauncher(meta: Meta, fallbackId = ''): Record<string, unknown> {
  const id = typeof meta.id === 'string' && meta.id.trim() ? meta.id.trim() : fallbackId;
  const title = metaTitle(meta, id);
  let poster: string | null = null;
  for (const candidate of [meta.poster, meta.background, meta.logo]) {
    poster = normalizePosterUrl(candidate);
    if (poster) break;
  }
  if (!poster && id) {
    poster = metahubPosterUrl(id, 'large');
  }
  const year = metaYear(meta);
  return {
    id,
    type: meta.type,
    name: title,
    title,
    year,
    poster: poster ?? undefined,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    releaseInfo: meta.releaseInfo,
    runtime: meta.runtime,
    source: meta.source,
  };
}

/** Minimal display meta when addon meta lookup fails but we have a Stremio id. */
export function stubMetaForLauncher(type: string, id: string): Record<string, unknown> | null {
  const poster = metahubPosterUrl(id, 'large');
  if (!poster) {
    return null;
  }
  return {
    id,
    type,
    poster,
  };
}

import type { CatalogCore } from '../core.js';
import { isBlockedCatalogMeta } from '../catalog-errors.js';
import { getTitlePlayability, queueTitleForVoiceIngest } from '../playability/db.js';
import { loadRailConfig, type CatalogTab } from '../rails.js';
import { metahubPosterUrl } from '../poster.js';
import { scoreTitleMatch } from './search.js';

export type ExternalSearchHit = {
  type: string;
  id: string;
  title: string;
  year?: string;
  poster?: string;
  tab: CatalogTab;
  score: number;
  in_library: boolean;
  library_status?: string;
  queued_for_verify: boolean;
};

function tabForType(type: string): CatalogTab {
  if (type.trim().toLowerCase() === 'series') {
    return 'series';
  }
  return 'movies';
}

function metaTitle(meta: Record<string, unknown>): string {
  if (typeof meta.name === 'string' && meta.name.trim()) {
    return meta.name.trim();
  }
  if (typeof meta.title === 'string' && meta.title.trim()) {
    return meta.title.trim();
  }
  return typeof meta.id === 'string' ? meta.id : 'unknown';
}

function metaYear(meta: Record<string, unknown>): string | undefined {
  if (meta.year !== undefined && meta.year !== null) {
    return String(meta.year);
  }
  const released = typeof meta.released === 'string' ? meta.released : '';
  const match = released.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}

async function defaultRailIdForTab(tab: CatalogTab): Promise<string> {
  const config = await loadRailConfig();
  const rail = config.rails.find(
    (entry) => entry.enabled !== false && 'tab' in entry && entry.tab === tab,
  );
  return rail?.id ?? (tab === 'series' ? 'series-global-popular' : 'movies-global-popular');
}

export async function searchExternalTitles(
  core: CatalogCore,
  query: string,
  options: {
    type?: 'movie' | 'series' | null;
    limit?: number;
    queue_missing?: boolean;
  } = {},
): Promise<{ ok: true; query: string; results: ExternalSearchHit[] }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { ok: true, query: trimmed, results: [] };
  }

  const types: Array<'movie' | 'series'> = options.type
    ? [options.type]
    : ['movie', 'series'];
  const limit = Math.max(1, Math.min(options.limit ?? 8, 12));
  const seen = new Set<string>();
  const results: ExternalSearchHit[] = [];

  for (const contentType of types) {
    const metas = await core.searchMeta(contentType, trimmed);
    for (const meta of metas) {
      if (isBlockedCatalogMeta(meta)) {
        continue;
      }
      const id = typeof meta.id === 'string' ? meta.id : '';
      if (!id) {
        continue;
      }
      const bareId = id.split(':')[0];
      const key = `${contentType}:${bareId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const playability = await getTitlePlayability(contentType, bareId);
      const inLibrary = playability?.status === 'verified';
      let queued = false;
      if (!inLibrary && options.queue_missing) {
        const tab = tabForType(contentType);
        const railId = await defaultRailIdForTab(tab);
        await queueTitleForVoiceIngest({
          type: contentType,
          id: bareId,
          title: metaTitle(meta as Record<string, unknown>),
          rail_id: railId,
          poster_url: metahubPosterUrl(bareId),
          year: metaYear(meta as Record<string, unknown>) ?? null,
        });
        queued = true;
      }

      const title = metaTitle(meta as Record<string, unknown>);
      results.push({
        type: contentType,
        id: bareId,
        title,
        year: metaYear(meta as Record<string, unknown>),
        poster: metahubPosterUrl(bareId) ?? undefined,
        tab: tabForType(contentType),
        score: scoreTitleMatch(title, trimmed),
        in_library: inLibrary,
        library_status: playability?.status,
        queued_for_verify: queued,
      });
    }
  }

  results.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.in_library !== right.in_library) {
      return left.in_library ? -1 : 1;
    }
    return left.title.localeCompare(right.title);
  });

  return { ok: true, query: trimmed, results: results.slice(0, limit) };
}

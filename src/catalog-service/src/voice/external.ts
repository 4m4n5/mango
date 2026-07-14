import type { CatalogCore } from '../core.js';
import { isBlockedCatalogMeta } from '../catalog-errors.js';
import { getTitlePlayability, queueTitleForVoiceIngest } from '../playability/db.js';
import { loadRailConfig } from '../rails.js';
import { metahubPosterUrl } from '../poster.js';
import { scoreTitleMatch } from './search.js';

type MangoBrowseTab = 'movies' | 'series' | 'live';

export type ExternalSearchHit = {
  type: string;
  id: string;
  title: string;
  year?: string;
  poster?: string;
  tab: MangoBrowseTab;
  score: number;
  in_library: boolean;
  library_status?: string;
  queued_for_verify: boolean;
};

export type PlayabilityIndexStatus = 'verified' | 'failed' | 'pending' | 'stale';

/**
 * Derives the couch-facing in_library / queued_for_verify signal from the
 * playability index status. `queued_for_verify` covers both a title already
 * sitting in 'pending' (queued by an earlier search) and one queued during
 * this call — the caller sets `queuedThisCall` once it actually enqueues.
 */
export function deriveLibraryVerifyState(
  status: PlayabilityIndexStatus | undefined,
): { inLibrary: boolean; alreadyQueued: boolean } {
  const inLibrary = status === 'verified';
  return { inLibrary, alreadyQueued: !inLibrary && status === 'pending' };
}

/**
 * Values safe to expose to the companion LLM. Never return raw `failed` /
 * `stale` — models echo those as "library status failed" and refuse titles
 * that are still openable via mango_open_title.
 */
export function couchFacingLibraryStatus(
  status: PlayabilityIndexStatus | undefined,
): 'verified' | 'pending' | undefined {
  if (status === 'verified' || status === 'pending') {
    return status;
  }
  return undefined;
}

/** Exact title match (score ≥ 100) that was tombstoned — re-queue for verify. */
export function shouldRequeueFailedExactMatch(
  status: PlayabilityIndexStatus | undefined,
  score: number,
): boolean {
  return (status === 'failed' || status === 'stale') && score >= 100;
}

function tabForType(type: string): MangoBrowseTab {
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

async function defaultRailIdForTab(tab: MangoBrowseTab): Promise<string> {
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

      const title = metaTitle(meta as Record<string, unknown>);
      const score = scoreTitleMatch(title, trimmed);
      const playability = await getTitlePlayability(contentType, bareId);
      const { inLibrary, alreadyQueued } = deriveLibraryVerifyState(playability?.status);
      let queued = alreadyQueued;
      const wantQueue =
        options.queue_missing
        || shouldRequeueFailedExactMatch(playability?.status, score);
      if (!inLibrary && !queued && wantQueue) {
        const tab = tabForType(contentType);
        const railId = await defaultRailIdForTab(tab);
        await queueTitleForVoiceIngest({
          type: contentType,
          id: bareId,
          title,
          rail_id: railId,
          poster_url: metahubPosterUrl(bareId),
          year: metaYear(meta as Record<string, unknown>) ?? null,
        });
        queued = true;
      }

      // After enqueue, index is pending — report that, never raw failed/stale.
      const facingStatus: PlayabilityIndexStatus | undefined = inLibrary
        ? 'verified'
        : queued
          ? 'pending'
          : playability?.status;
      results.push({
        type: contentType,
        id: bareId,
        title,
        year: metaYear(meta as Record<string, unknown>),
        poster: metahubPosterUrl(bareId) ?? undefined,
        tab: tabForType(contentType),
        score,
        in_library: inLibrary,
        library_status: couchFacingLibraryStatus(facingStatus),
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

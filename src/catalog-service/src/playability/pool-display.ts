import { metahubPosterUrl, normalizePosterUrl } from '../poster.js';
import type { RailPoolEntry } from './db.js';
import type { CandidateMeta } from './list-source.js';

export type RailPoolDisplayPatch = Pick<RailPoolEntry, 'title' | 'poster_url' | 'year'>;

/** Snapshot title/poster from catalog ingest for rail_pool browse cache. */
export function displaySnapshotFromCandidate(candidate: CandidateMeta): RailPoolDisplayPatch {
  const title = candidate.title?.trim() || undefined;
  const poster_url = normalizePosterUrl(candidate.poster)
    ?? metahubPosterUrl(candidate.id)
    ?? undefined;
  const year = candidate.year !== undefined && candidate.year !== null
    ? String(candidate.year)
    : undefined;
  return { title, poster_url, year };
}

export function mergePoolDisplayPatch(
  existing: RailPoolDisplayPatch | undefined,
  patch: RailPoolDisplayPatch,
): RailPoolDisplayPatch {
  return {
    title: patch.title ?? existing?.title,
    poster_url: patch.poster_url ?? existing?.poster_url,
    year: patch.year ?? existing?.year,
  };
}

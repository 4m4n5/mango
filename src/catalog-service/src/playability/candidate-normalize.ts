import type { CatalogCore, Meta } from '../core.js';
import type { CandidateMeta } from './list-source.js';
import { canonicalTitleId } from './ids.js';

const IMDB_ID = /^tt\d+$/i;
const TMDB_ID = /^tmdb:\d+$/i;

type SearchCore = Pick<CatalogCore, 'searchMeta'>;

function normalizedTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized || null;
}

function titleForMeta(meta: Meta): string | null {
  return normalizedTitle(meta.name ?? meta.title);
}

function yearFromValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== 'string') return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? null;
}

function yearForCandidate(candidate: CandidateMeta): string | null {
  return yearFromValue(candidate.year);
}

function yearForMeta(meta: Meta): string | null {
  return yearFromValue(meta.year)
    ?? yearFromValue(meta.releaseInfo)
    ?? yearFromValue(meta.released);
}

function imdbIdForMeta(meta: Meta): string | null {
  const id = typeof meta.id === 'string' ? meta.id.trim() : '';
  if (IMDB_ID.test(id)) {
    return id;
  }
  return null;
}

export async function normalizeExternalCandidateId(
  core: SearchCore,
  candidate: CandidateMeta,
): Promise<CandidateMeta> {
  if (!TMDB_ID.test(candidate.id) || !candidate.title?.trim()) {
    return candidate;
  }

  const targetTitle = normalizedTitle(candidate.title);
  if (!targetTitle) {
    return candidate;
  }

  let metas: Meta[];
  try {
    metas = await core.searchMeta(candidate.type, candidate.title);
  } catch {
    return candidate;
  }

  const exact = metas.filter((meta) => (
    imdbIdForMeta(meta) !== null && titleForMeta(meta) === targetTitle
  ));
  if (exact.length === 0) {
    return candidate;
  }

  const targetYear = yearForCandidate(candidate);
  const yearMatched = targetYear
    ? exact.filter((meta) => yearForMeta(meta) === targetYear)
    : [];
  const chosen = yearMatched.length === 1
    ? yearMatched[0]
    : exact.length === 1
      ? exact[0]
      : null;
  const imdbId = chosen ? imdbIdForMeta(chosen) : null;
  if (!imdbId) {
    return candidate;
  }

  return {
    ...candidate,
    id: canonicalTitleId(candidate.type, imdbId),
    poster: candidate.poster ?? (typeof chosen?.poster === 'string' ? chosen.poster : undefined),
    title: candidate.title ?? (typeof chosen?.name === 'string' ? chosen.name : undefined),
    year: candidate.year ?? chosen?.year,
  };
}

export function createCandidateNormalizer(
  core: SearchCore,
): (candidate: CandidateMeta) => Promise<CandidateMeta> {
  const cache = new Map<string, Promise<CandidateMeta>>();
  return (candidate) => {
    const key = `${candidate.type}:${candidate.id}:${candidate.title ?? ''}:${candidate.year ?? ''}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const normalized = normalizeExternalCandidateId(core, candidate);
    cache.set(key, normalized);
    return normalized;
  };
}

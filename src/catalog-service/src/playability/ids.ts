const BARE_IMDB_ID = /^tt\d+$/i;
const EPISODE_IMDB_ID = /^tt\d+:\d+:\d+$/i;

export function seriesBareId(id: string): string | null {
  const trimmed = id.trim();
  if (BARE_IMDB_ID.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^(tt\d+):\d+:\d+$/i);
  return match?.[1] ?? null;
}

export function canonicalTitleId(type: string, id: string): string {
  const trimmed = id.trim();
  if (type === 'series') {
    return seriesBareId(trimmed) ?? trimmed;
  }
  return trimmed;
}

/** Stremio series catalogs expose bare IMDB ids; stream resolve needs S1E1. */
export function normalizeSeriesVerifyId(type: string, id: string): string {
  if (type !== 'series') {
    return id;
  }
  const trimmed = id.trim();
  if (BARE_IMDB_ID.test(trimmed)) {
    return `${trimmed}:1:1`;
  }
  return trimmed;
}

/** True when playability index applies (bare series id or S1E1 only — not other episodes). */
export function isSeriesRailGateId(id: string): boolean {
  const trimmed = id.trim();
  if (BARE_IMDB_ID.test(trimmed)) {
    return true;
  }
  return /^tt\d+:1:1$/i.test(trimmed);
}

export function isSeriesEpisodeId(id: string): boolean {
  return EPISODE_IMDB_ID.test(id.trim());
}

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

/** Next episodes to verify after S1E1 passes (S1E2–S1E4). Playback tooling polls these later. */
export function seriesFollowUpEpisodeIds(seriesBareId: string, count = 3): string[] {
  const base = seriesBareId.trim();
  if (!BARE_IMDB_ID.test(base)) {
    return [];
  }
  const episodes: string[] = [];
  for (let episode = 2; episode <= count + 1; episode += 1) {
    episodes.push(`${base}:1:${episode}`);
  }
  return episodes;
}

export function isSeriesEpisodeId(id: string): boolean {
  return EPISODE_IMDB_ID.test(id.trim());
}

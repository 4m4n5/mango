import type { Meta } from './core.js';
import type { WatchProgressRecord } from './progress/db.js';
import { progressPct } from './progress/keys.js';
import { titleKey } from './playability/session-select.js';

export type CinemetaVideo = {
  id?: string;
  season?: number;
  episode?: number;
  title?: string;
  name?: string;
  thumbnail?: string;
  released?: string;
  [key: string]: unknown;
};

export type SeriesEpisodeRow = {
  id: string;
  season: number;
  episode: number;
  title: string;
  thumbnail?: string;
  progress_pct: number | null;
  /** null = unknown until stream probe; true/false from playability index when known */
  playable: boolean | null;
};

export type SeriesSeasonBlock = {
  season: number;
  label: string;
  episodes: SeriesEpisodeRow[];
};

export type SeriesResumeInfo = {
  episode_id: string;
  position_sec: number;
  duration_sec: number;
  progress_pct: number;
};

export type SeriesEpisodesResponse = {
  series_id: string;
  name: string;
  seasons: SeriesSeasonBlock[];
  resume: SeriesResumeInfo | null;
  episode_count: number;
  /** Main-line default play target (S1E1) — excludes bonus season. */
  default_episode_id: string | null;
};

/** BTS / extras rows in Cinemeta videos[] (e.g. Chernobyl season 0). */
const BTS_TITLE_RE = /\b(behind the scenes|featurette|inside the episode|trailer|preview|making of|deleted scene)\b/i;

/** Route to Bonus block — season 0 or BTS/extras titles (never dropped). */
export function isBonusBucketEpisode(video: CinemetaVideo): boolean {
  const season = Number(video.season ?? -1);
  if (season === 0) {
    return true;
  }
  const title = `${video.title || ''} ${video.name || ''}`.toLowerCase();
  if (BTS_TITLE_RE.test(title)) {
    return true;
  }
  if (season >= 1 && /\b(bonus|extras?|bts)\b/.test(title)) {
    return true;
  }
  return false;
}

/** @deprecated Use isBonusBucketEpisode — kept for tests and external callers. */
export function isSupplementalMetaEpisode(video: CinemetaVideo): boolean {
  return isBonusBucketEpisode(video);
}

export function seasonBlockLabel(season: number): string {
  if (season === 0) {
    return 'Bonus';
  }
  return `Season ${season}`;
}

/** First episode of the lowest main season (S1E1 when present). */
export function defaultMainEpisodeId(seasons: SeriesSeasonBlock[]): string | null {
  const mainSeasons = seasons
    .filter((block) => block.season >= 1)
    .sort((left, right) => left.season - right.season);
  return mainSeasons[0]?.episodes[0]?.id ?? null;
}

function compareSeasonBlocks(left: number, right: number): number {
  if (left === 0) {
    return 1;
  }
  if (right === 0) {
    return -1;
  }
  return left - right;
}

export function normalizeSeriesEpisodes(
  bareId: string,
  videos: CinemetaVideo[],
): { seasons: SeriesSeasonBlock[] } {
  const bySeason = new Map<number, SeriesEpisodeRow[]>();
  const bonusRows: SeriesEpisodeRow[] = [];

  for (const video of videos) {
    const episodeId = typeof video.id === 'string' ? video.id.trim() : '';
    const season = Number(video.season);
    const episode = Number(video.episode);
    if (!episodeId || !Number.isFinite(season) || !Number.isFinite(episode) || season < 0) {
      continue;
    }
    const row: SeriesEpisodeRow = {
      id: episodeId,
      season,
      episode,
      title: (video.title || video.name || `Episode ${episode}`).trim(),
      thumbnail: typeof video.thumbnail === 'string' ? video.thumbnail : undefined,
      progress_pct: null,
      playable: null,
    };
    if (isBonusBucketEpisode(video)) {
      bonusRows.push(row);
      continue;
    }
    const bucket = bySeason.get(season) || [];
    bucket.push(row);
    bySeason.set(season, bucket);
  }

  if (bonusRows.length > 0) {
    bySeason.set(
      0,
      bonusRows.sort((left, right) => {
        if (left.season !== right.season) {
          return left.season - right.season;
        }
        return left.episode - right.episode;
      }),
    );
  }

  const seasons = [...bySeason.entries()]
    .sort(([left], [right]) => compareSeasonBlocks(left, right))
    .map(([season, episodes]) => ({
      season,
      label: seasonBlockLabel(season),
      episodes: episodes.sort((left, right) => {
        if (left.season !== right.season) {
          return left.season - right.season;
        }
        return left.episode - right.episode;
      }),
    }));

  return { seasons };
}

export function applyEpisodeProgress(
  seasons: SeriesSeasonBlock[],
  saved: WatchProgressRecord | null,
): void {
  if (!saved?.play_id) {
    return;
  }
  for (const block of seasons) {
    for (const row of block.episodes) {
      if (row.id === saved.play_id) {
        row.progress_pct = progressPct(saved.position_sec, saved.duration_sec);
      }
    }
  }
}

/** Playability index hints — episodes without rows stay null (client stream probe). */
export function applyEpisodePlayability(
  seasons: SeriesSeasonBlock[],
  playability: Map<string, { status: string; expires_at: number | null }>,
): void {
  const now = Date.now();
  for (const block of seasons) {
    for (const row of block.episodes) {
      const record = playability.get(titleKey('series', row.id));
      if (!record) {
        row.playable = null;
        continue;
      }
      if (record.status === 'verified' && (record.expires_at ?? 0) > now) {
        row.playable = true;
      } else if (record.status === 'failed') {
        row.playable = false;
      } else {
        row.playable = null;
      }
    }
  }
}

export function buildSeriesResumeInfo(
  saved: WatchProgressRecord | null,
): SeriesResumeInfo | null {
  if (!saved?.play_id) {
    return null;
  }
  return {
    episode_id: saved.play_id,
    position_sec: saved.position_sec,
    duration_sec: saved.duration_sec,
    progress_pct: saved.progress_pct,
  };
}

export function nextEpisodeId(
  seasons: SeriesSeasonBlock[],
  currentEpisodeId: string,
): string | null {
  const flat = seasons.flatMap((block) => block.episodes);
  const index = flat.findIndex((row) => row.id === currentEpisodeId);
  if (index < 0 || index >= flat.length - 1) {
    return null;
  }
  return flat[index + 1]?.id ?? null;
}

export function buildSeriesEpisodesResponse(
  bareId: string,
  meta: Meta,
  seasons: SeriesSeasonBlock[],
  resume: SeriesResumeInfo | null,
): SeriesEpisodesResponse {
  const episodeCount = seasons.reduce((total, block) => total + block.episodes.length, 0);
  return {
    series_id: bareId,
    name: typeof meta.name === 'string'
      ? meta.name
      : typeof meta.title === 'string'
        ? meta.title
        : bareId,
    seasons,
    resume,
    episode_count: episodeCount,
    default_episode_id: defaultMainEpisodeId(seasons),
  };
}

export async function assembleSeriesEpisodes(
  bareId: string,
  meta: Meta,
  saved: WatchProgressRecord | null,
): Promise<SeriesEpisodesResponse> {
  const videos = Array.isArray(meta.videos) ? meta.videos as CinemetaVideo[] : [];
  const normalized = normalizeSeriesEpisodes(bareId, videos);
  applyEpisodeProgress(normalized.seasons, saved);
  return buildSeriesEpisodesResponse(
    bareId,
    meta,
    normalized.seasons,
    buildSeriesResumeInfo(saved),
  );
}

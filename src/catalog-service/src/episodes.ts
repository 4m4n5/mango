import type { Meta } from './core.js';
import type { WatchProgressRecord } from './progress/db.js';
import { progressPct } from './progress/keys.js';

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
};

/** BTS / extras rows in Cinemeta videos[] (e.g. Chernobyl season 0). */
export function isSupplementalMetaEpisode(video: CinemetaVideo): boolean {
  const season = Number(video.season ?? -1);
  if (season <= 0) {
    return true;
  }
  const title = `${video.title || ''} ${video.name || ''}`.toLowerCase();
  return /\b(behind the scenes|featurette|inside the episode|trailer|preview|bonus)\b/.test(title);
}

export function normalizeSeriesEpisodes(
  bareId: string,
  videos: CinemetaVideo[],
): { seasons: SeriesSeasonBlock[] } {
  const bySeason = new Map<number, SeriesEpisodeRow[]>();

  for (const video of videos) {
    if (isSupplementalMetaEpisode(video)) {
      continue;
    }
    const episodeId = typeof video.id === 'string' ? video.id.trim() : '';
    const season = Number(video.season);
    const episode = Number(video.episode);
    if (!episodeId || !Number.isFinite(season) || !Number.isFinite(episode) || season < 1) {
      continue;
    }
    const row: SeriesEpisodeRow = {
      id: episodeId,
      season,
      episode,
      title: (video.title || video.name || `Episode ${episode}`).trim(),
      thumbnail: typeof video.thumbnail === 'string' ? video.thumbnail : undefined,
      progress_pct: null,
    };
    const bucket = bySeason.get(season) || [];
    bucket.push(row);
    bySeason.set(season, bucket);
  }

  const seasons = [...bySeason.entries()]
    .sort(([left], [right]) => left - right)
    .map(([season, episodes]) => ({
      season,
      label: `Season ${season}`,
      episodes: episodes.sort((left, right) => left.episode - right.episode),
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

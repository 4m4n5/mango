import { nextEpisodeId, type SeriesSeasonBlock } from '../episodes.js';
import { progressPct } from './keys.js';
import type { ActiveWatchSession } from './watcher.js';

export const NEXT_PROMPT_MIN_PCT = 0.5;

export type PendingNextPrompt = {
  series_id: string;
  episode_id: string;
  progress_pct: number;
  position_sec: number;
  duration_sec: number;
};

export type NextPromptResponse = {
  show: boolean;
  series_id?: string;
  series_name?: string;
  from_episode_id?: string;
  progress_pct?: number;
  next?: {
    id: string;
    season: number;
    episode: number;
    title: string;
  };
};

let pendingNextPrompt: PendingNextPrompt | null = null;

export function resetPendingNextPromptForTests(): void {
  pendingNextPrompt = null;
}

export function notePlaybackExit(
  session: ActiveWatchSession,
  positionSec: number,
  durationSec: number,
): void {
  if (session.type !== 'series' || durationSec <= 0) {
    return;
  }
  const progress_pct = progressPct(positionSec, durationSec);
  if (progress_pct < NEXT_PROMPT_MIN_PCT) {
    return;
  }
  pendingNextPrompt = {
    series_id: session.title_id,
    episode_id: session.play_id,
    progress_pct,
    position_sec: positionSec,
    duration_sec: durationSec,
  };
}

export function takePendingNextPrompt(): PendingNextPrompt | null {
  const value = pendingNextPrompt;
  pendingNextPrompt = null;
  return value;
}

export function buildNextPromptResponse(
  pending: PendingNextPrompt,
  seasons: SeriesSeasonBlock[],
  seriesName: string,
): NextPromptResponse {
  const nextId = nextEpisodeId(seasons, pending.episode_id);
  if (!nextId) {
    return { show: false };
  }
  const flat = seasons.flatMap((block) => block.episodes);
  const next = flat.find((row) => row.id === nextId);
  if (!next || next.playable === false) {
    return { show: false };
  }
  return {
    show: true,
    series_id: pending.series_id,
    series_name: seriesName,
    from_episode_id: pending.episode_id,
    progress_pct: pending.progress_pct,
    next: {
      id: next.id,
      season: next.season,
      episode: next.episode,
      title: next.title,
    },
  };
}

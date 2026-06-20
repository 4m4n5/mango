import {
  isSeriesEpisodeId,
  normalizeSeriesVerifyId,
  seriesBareId,
} from './playability/ids.js';
import { isContinueEligible } from './progress/keys.js';
import type { WatchProgressRecord } from './progress/db.js';

const BARE_IMDB_ID = /^tt\d+$/i;

export type SeriesPlayResolveReason = 'explicit' | 'resume' | 'latest' | 'default_s1e1';

export type SeriesPlayTarget = {
  playId: string;
  startSec?: number;
  resolved_from: SeriesPlayResolveReason;
};

/** Map bare series ids to resume episode or S1E1; pass episode ids through. */
export function resolveSeriesPlayTarget(
  type: string,
  id: string,
  options: {
    saved?: WatchProgressRecord | null;
    resume?: boolean;
    startSec?: number;
  } = {},
): SeriesPlayTarget {
  if (type.trim().toLowerCase() !== 'series') {
    return {
      playId: id,
      startSec: options.startSec,
      resolved_from: 'explicit',
    };
  }

  const trimmed = id.trim();
  if (isSeriesEpisodeId(trimmed)) {
    let startSec = options.startSec;
    if (options.resume && options.saved?.play_id === trimmed) {
      startSec = startSec ?? options.saved.position_sec;
    }
    return {
      playId: trimmed,
      startSec,
      resolved_from: 'explicit',
    };
  }

  const bare = seriesBareId(trimmed) || trimmed;
  const saved = options.saved ?? null;
  if (
    saved
    && isContinueEligible(saved.position_sec, saved.duration_sec)
    && saved.play_id
  ) {
    return {
      playId: saved.play_id,
      startSec: options.startSec ?? saved.position_sec,
      resolved_from: options.resume ? 'resume' : 'latest',
    };
  }

  const fallbackId = BARE_IMDB_ID.test(bare)
    ? normalizeSeriesVerifyId('series', bare)
    : normalizeSeriesVerifyId('series', trimmed);

  return {
    playId: fallbackId,
    startSec: options.startSec,
    resolved_from: 'default_s1e1',
  };
}

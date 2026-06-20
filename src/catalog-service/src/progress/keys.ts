import { seriesBareId } from '../playability/ids.js';
import { PROGRESS_CONTINUE_MAX, PROGRESS_CONTINUE_MIN, PROGRESS_CONTINUE_MIN_SEC } from './config.js';

export function progressTitleKey(type: string, id: string): string {
  const normalizedType = type.trim().toLowerCase();
  if (normalizedType === 'series') {
    const bare = seriesBareId(id);
    return bare ? `series:${bare.toLowerCase()}` : `series:${id.trim().toLowerCase()}`;
  }
  return `movie:${id.trim().toLowerCase()}`;
}

export function progressTabForType(type: string): 'movies' | 'series' {
  return type.trim().toLowerCase() === 'series' ? 'series' : 'movies';
}

export function progressPct(positionSec: number, durationSec: number): number {
  if (!Number.isFinite(positionSec) || !Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, positionSec / durationSec));
}

export function isContinueEligible(positionSec: number, durationSec: number): boolean {
  const pct = progressPct(positionSec, durationSec);
  if (pct >= PROGRESS_CONTINUE_MAX) {
    return false;
  }
  if (positionSec >= PROGRESS_CONTINUE_MIN_SEC) {
    return true;
  }
  return pct >= PROGRESS_CONTINUE_MIN;
}

export function episodeLabel(playId: string): string | null {
  const match = playId.trim().match(/^tt\d+:(\d+):(\d+)$/i);
  if (!match) {
    return null;
  }
  return `S${match[1]} E${match[2]}`;
}

export function continueSubtitle(playId: string, type: string, pct: number): string {
  const percent = `${Math.round(pct * 100)}%`;
  if (type === 'series') {
    const episode = episodeLabel(playId);
    if (episode) {
      return `${episode} · ${percent}`;
    }
  }
  return `${percent} watched`;
}

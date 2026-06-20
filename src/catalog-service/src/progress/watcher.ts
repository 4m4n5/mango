import { getMpvPlaybackState, isMpvActive } from '../mpv.js';
import { upsertWatchProgress } from './db.js';
import { progressTitleKey } from './keys.js';

export type ActiveWatchSession = {
  type: string;
  title_id: string;
  play_id: string;
  title?: string | null;
  poster?: string | null;
};

let activeSession: ActiveWatchSession | null = null;
let pollTimer: NodeJS.Timeout | null = null;

export function beginWatchSession(session: ActiveWatchSession): void {
  activeSession = session;
  ensurePollLoop();
}

export function clearWatchSession(): void {
  activeSession = null;
}

export async function flushWatchProgress(): Promise<boolean> {
  const session = activeSession;
  const playback = await getMpvPlaybackState();
  if (session && playback && playback.duration_sec > 0) {
    upsertWatchProgress({
      type: session.type,
      id: session.title_id,
      play_id: session.play_id,
      title: session.title,
      poster: session.poster,
      position_sec: playback.position_sec,
      duration_sec: playback.duration_sec,
    });
  }
  const stillActive = await isMpvActive();
  if (!stillActive) {
    activeSession = null;
    stopPollLoop();
  }
  return Boolean(session && playback);
}

function ensurePollLoop(): void {
  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(() => {
    void flushWatchProgress();
  }, Number(process.env.MANGO_PROGRESS_POLL_MS || 30_000));
  pollTimer.unref?.();
}

function stopPollLoop(): void {
  if (!pollTimer) {
    return;
  }
  clearInterval(pollTimer);
  pollTimer = null;
}

export function activeWatchSession(): ActiveWatchSession | null {
  return activeSession;
}

export function resetWatchWatcherForTests(): void {
  activeSession = null;
  stopPollLoop();
}

export function startWatchSessionFromPlay(input: {
  type: string;
  id: string;
  title?: string | null;
  poster?: string | null;
}): void {
  const titleId = input.type === 'series' && input.id.includes(':')
    ? input.id.split(':')[0]
    : input.id;
  beginWatchSession({
    type: input.type,
    title_id: titleId,
    play_id: input.id,
    title: input.title,
    poster: input.poster,
  });
}

export function progressKeyForSession(session: ActiveWatchSession): string {
  return progressTitleKey(session.type, session.play_id);
}

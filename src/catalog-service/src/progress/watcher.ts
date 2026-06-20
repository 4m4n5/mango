import { getMpvPlaybackState, isMpvActive } from '../mpv.js';
import { upsertWatchProgress } from './db.js';

export type ActiveWatchSession = {
  type: string;
  title_id: string;
  play_id: string;
  title?: string | null;
  poster?: string | null;
};

let activeSession: ActiveWatchSession | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastSnapshot: {
  session: ActiveWatchSession;
  position_sec: number;
  duration_sec: number;
} | null = null;

function sessionKey(session: ActiveWatchSession): string {
  return `${session.type}:${session.play_id}`;
}

function persistSessionProgress(
  session: ActiveWatchSession,
  position_sec: number,
  duration_sec: number,
): void {
  if (duration_sec <= 0) {
    return;
  }
  lastSnapshot = {
    session: { ...session },
    position_sec,
    duration_sec,
  };
  upsertWatchProgress({
    type: session.type,
    id: session.title_id,
    play_id: session.play_id,
    title: session.title,
    poster: session.poster,
    position_sec,
    duration_sec,
  });
}

export async function handoffWatchSession(session: ActiveWatchSession): Promise<void> {
  if (activeSession && sessionKey(activeSession) !== sessionKey(session)) {
    await flushWatchProgress();
  }
  activeSession = session;
  ensurePollLoop();
}

export function clearWatchSession(): void {
  activeSession = null;
  lastSnapshot = null;
}

export async function flushWatchProgress(): Promise<boolean> {
  const session = activeSession;
  if (!session) {
    return false;
  }

  const playback = await getMpvPlaybackState();
  if (playback && playback.duration_sec > 0) {
    persistSessionProgress(session, playback.position_sec, playback.duration_sec);
  } else if (
    lastSnapshot
    && sessionKey(lastSnapshot.session) === sessionKey(session)
  ) {
    persistSessionProgress(
      session,
      lastSnapshot.position_sec,
      lastSnapshot.duration_sec,
    );
  }

  const stillActive = await isMpvActive();
  if (!stillActive) {
    activeSession = null;
    stopPollLoop();
  }
  return Boolean(playback || lastSnapshot);
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
  lastSnapshot = null;
  stopPollLoop();
}

export async function startWatchSessionFromPlay(input: {
  type: string;
  id: string;
  title?: string | null;
  poster?: string | null;
}): Promise<void> {
  const titleId = input.type === 'series' && input.id.includes(':')
    ? input.id.split(':')[0]
    : input.id;
  await handoffWatchSession({
    type: input.type,
    title_id: titleId,
    play_id: input.id,
    title: input.title,
    poster: input.poster,
  });
}

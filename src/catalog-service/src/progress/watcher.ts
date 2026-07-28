import { getMpvPlaybackState, isMpvActive } from '../mpv.js';
import { notePlaybackExit } from './next-prompt.js';
import { upsertWatchProgress } from './db.js';
import { recordPlaybackExit, recordPlayStarted } from '../companion/watch-signals.js';
import type { CatalogTab } from '../rails.js';
import { recordStreamLongWatch } from '../playability/db.js';
import { playbackProfileId, type StreamTechnicalProfile } from '../playback-capability.js';

export type ActiveWatchSession = {
  source?: string | null;
  type: string;
  title_id: string;
  play_id: string;
  title?: string | null;
  poster?: string | null;
  tab?: CatalogTab | null;
  release_fingerprint?: string | null;
  technical?: StreamTechnicalProfile | null;
  long_watch_recorded?: boolean;
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
    source: session.source,
    type: session.type,
    id: session.title_id,
    play_id: session.play_id,
    title: session.title,
    poster: session.poster,
    position_sec,
    duration_sec,
    tab: session.tab,
  });
  const substantialAt = Math.min(20 * 60, duration_sec * 0.5);
  if (
    !session.long_watch_recorded
    && session.release_fingerprint
    && position_sec >= substantialAt
  ) {
    try {
      recordStreamLongWatch({
        release_fingerprint: session.release_fingerprint,
        profile_id: playbackProfileId(),
        technical: session.technical ?? null,
      });
      session.long_watch_recorded = true;
    } catch {
      // Progress remains authoritative when optional path evidence is unavailable.
    }
  }
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
    notePlaybackExit(session, playback.position_sec, playback.duration_sec);
    void recordPlaybackExit(session, playback.position_sec, playback.duration_sec).catch(() => undefined);
  } else if (
    lastSnapshot
    && sessionKey(lastSnapshot.session) === sessionKey(session)
  ) {
    persistSessionProgress(
      session,
      lastSnapshot.position_sec,
      lastSnapshot.duration_sec,
    );
    notePlaybackExit(session, lastSnapshot.position_sec, lastSnapshot.duration_sec);
    void recordPlaybackExit(session, lastSnapshot.position_sec, lastSnapshot.duration_sec).catch(() => undefined);
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
  source?: string | null;
  type: string;
  id: string;
  title?: string | null;
  poster?: string | null;
  tab?: CatalogTab | null;
  releaseFingerprint?: string | null;
  technical?: StreamTechnicalProfile | null;
}): Promise<void> {
  const titleId = input.type === 'series' && input.id.includes(':')
    ? input.id.split(':')[0]
    : input.id;
  await handoffWatchSession({
    source: input.source,
    type: input.type,
    title_id: titleId,
    play_id: input.id,
    title: input.title,
    poster: input.poster,
    tab: input.tab,
    release_fingerprint: input.releaseFingerprint,
    technical: input.technical,
  });
  recordPlayStarted({
    source: input.source,
    type: input.type,
    title_id: titleId,
    play_id: input.id,
    title: input.title,
    poster: input.poster,
    tab: input.tab,
  });
}

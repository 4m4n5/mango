import { getMpvPlaybackState, isMpvActive } from '../mpv.js';
import { notePlaybackExit } from './next-prompt.js';
import { upsertWatchProgress } from './db.js';
import { recordPlaybackExit, recordPlayStarted } from '../companion/watch-signals.js';
import type { CatalogTab } from '../rails.js';
import { recordStreamLongWatch } from '../playability/db.js';
import { playbackProfileId, type StreamTechnicalProfile } from '../playback-capability.js';
import {
  activeViewerProfileId,
  recordRecommendationPlayStart,
  recordRecommendationProgress,
} from '../library/db.js';
import { incrementRecommendationMetric } from '../recommendations/service.js';

export type ActiveWatchSession = {
  /** Viewer identity captured when this play was accepted. */
  profile_id?: string;
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
  recommendation_refresh_stage?: number;
  recommendation?: {
    profile_id: string;
    domain: 'vod' | 'youtube';
    rail_id: string;
    slate_revision: number;
    /** Immutable served-card identity, which can differ from an episode play id. */
    item_type: string;
    item_id: string;
  };
};

let activeSession: ActiveWatchSession | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let lastSnapshot: {
  session: ActiveWatchSession;
  position_sec: number;
  duration_sec: number;
} | null = null;

export type RecommendationSignalChange = {
  profile_id: string;
  type: 'movie' | 'series';
  title_id: string;
  stage: 'play' | 'meaningful' | 'completed';
};

let recommendationSignalChangeHook: ((change: RecommendationSignalChange) => void) | null = null;

export function setRecommendationSignalChangeHook(
  hook: ((change: RecommendationSignalChange) => void) | null,
): void {
  recommendationSignalChangeHook = hook;
}

export function recommendationRefreshStageForProgress(progressPct: number): number {
  if (progressPct >= 0.9) return 3;
  if (progressPct >= 0.25) return 2;
  return 1;
}

function notifyRecommendationSignalChange(
  session: ActiveWatchSession,
  stage: RecommendationSignalChange['stage'],
): void {
  if ((session.type !== 'movie' && session.type !== 'series') || session.source === 'youtube') return;
  try {
    recommendationSignalChangeHook?.({
      profile_id: session.profile_id ?? activeViewerProfileId(),
      type: session.type,
      title_id: session.title_id,
      stage,
    });
  } catch {
    // Playback/progress must never depend on optional recommendation refresh.
  }
}

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
    profile_id: session.profile_id,
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
  const progress = position_sec / duration_sec;
  const nextRefreshStage = recommendationRefreshStageForProgress(progress);
  const previousRefreshStage = session.recommendation_refresh_stage ?? 1;
  if (nextRefreshStage > previousRefreshStage) {
    session.recommendation_refresh_stage = nextRefreshStage;
    notifyRecommendationSignalChange(
      session,
      nextRefreshStage >= 3 ? 'completed' : 'meaningful',
    );
  }
  if (session.recommendation) {
    try {
      recordRecommendationProgress({
        ...session.recommendation,
        progress_pct: position_sec / duration_sec,
      });
    } catch {
      // Playback progress remains authoritative if optional attribution fails.
    }
  }
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
  recommendationSignalChangeHook = null;
}

export async function startWatchSessionFromPlay(input: {
  profile_id?: string;
  source?: string | null;
  type: string;
  id: string;
  title?: string | null;
  poster?: string | null;
  tab?: CatalogTab | null;
  releaseFingerprint?: string | null;
  technical?: StreamTechnicalProfile | null;
  recommendation?: ActiveWatchSession['recommendation'];
}): Promise<void> {
  const titleId = input.type === 'series' && input.id.includes(':')
    ? input.id.split(':')[0]
    : input.id;
  const profileId = input.profile_id ?? input.recommendation?.profile_id ?? activeViewerProfileId();
  const sameLogicalSession = activeSession?.profile_id === profileId
    && activeSession.type === input.type
    && activeSession.play_id === input.id;
  await handoffWatchSession({
    profile_id: profileId,
    source: input.source,
    type: input.type,
    title_id: titleId,
    play_id: input.id,
    title: input.title,
    poster: input.poster,
    tab: input.tab,
    release_fingerprint: input.releaseFingerprint,
    technical: input.technical,
    recommendation: input.recommendation,
    recommendation_refresh_stage: 1,
  });
  if (!sameLogicalSession) notifyRecommendationSignalChange(activeSession!, 'play');
  if (input.recommendation) {
    try {
      const firstAttributedPlayStart = recordRecommendationPlayStart({
        ...input.recommendation,
      });
      if (
        firstAttributedPlayStart
        && input.recommendation.domain === 'vod'
        && (
          input.recommendation.rail_id === 'for-you-movies'
          || input.recommendation.rail_id === 'for-you-series'
        )
      ) {
        incrementRecommendationMetric('play_starts_for_you', input.recommendation.profile_id);
      }
    } catch {
      // Watching must never depend on optional recommendation telemetry.
    }
  }
  recordPlayStarted({
    profile_id: profileId,
    source: input.source,
    type: input.type,
    title_id: titleId,
    play_id: input.id,
    title: input.title,
    poster: input.poster,
    tab: input.tab,
    recommendation: input.recommendation,
  });
}

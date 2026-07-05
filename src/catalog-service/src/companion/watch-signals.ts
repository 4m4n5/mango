import type { ActiveWatchSession } from '../progress/watcher.js';
import { PROGRESS_CONTINUE_MAX, PROGRESS_CONTINUE_MIN, PROGRESS_CONTINUE_MIN_SEC } from '../progress/config.js';
import { progressPct } from '../progress/keys.js';
import { writeCompiledNotes } from './compile-notes.js';
import { appendJournalEvent, journalHasPlayCompleted } from './journal.js';
import { applyFamiliarityStage, patchProfile, readProfile, writeProfile } from './profile.js';

export function watchContentKey(session: ActiveWatchSession): string {
  return `${session.type}:${session.title_id}`;
}

export function recordPlayStarted(session: ActiveWatchSession): void {
  appendJournalEvent('play_started', {
    content_key: watchContentKey(session),
    type: session.type,
    title_id: session.title_id,
    play_id: session.play_id,
    title: session.title ?? null,
    tab: session.tab ?? null,
    source: session.source ?? null,
  });
}

export async function recordPlaybackExit(
  session: ActiveWatchSession,
  positionSec: number,
  durationSec: number,
): Promise<void> {
  if (durationSec <= 0) {
    return;
  }
  const pct = progressPct(positionSec, durationSec);
  const payload = {
    content_key: watchContentKey(session),
    type: session.type,
    title_id: session.title_id,
    play_id: session.play_id,
    title: session.title ?? null,
    tab: session.tab ?? null,
    source: session.source ?? null,
    progress_pct: Math.round(pct * 1000) / 1000,
    position_sec: positionSec,
    duration_sec: durationSec,
  };

  if (pct >= PROGRESS_CONTINUE_MAX) {
    const alreadyCompleted = journalHasPlayCompleted(payload.content_key);
    appendJournalEvent('play_completed', payload);
    if (!alreadyCompleted) {
      const current = await readProfile();
      const patched = await patchProfile({
        familiarity: { completed_watches: current.familiarity.completed_watches + 1 },
      });
      const staged = applyFamiliarityStage(patched);
      await writeProfile(staged);
      await writeCompiledNotes(staged);
    }
    return;
  }

  if (pct >= PROGRESS_CONTINUE_MIN || positionSec >= PROGRESS_CONTINUE_MIN_SEC) {
    appendJournalEvent('play_abandoned', payload);
  }
}

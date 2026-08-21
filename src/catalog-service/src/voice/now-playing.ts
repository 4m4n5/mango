import { getMpvPlaybackState, isMpvActive } from '../mpv.js';
import { activeWatchSession } from '../progress/watcher.js';
import { listContinueItems } from '../progress/db.js';
import type { CatalogTab } from '../rails.js';

export async function buildNowPlayingResponse(): Promise<Record<string, unknown>> {
  const session = activeWatchSession();
  const mpvActive = await isMpvActive();
  const playback = mpvActive ? await getMpvPlaybackState() : null;

  if (!session && !mpvActive) {
    return {
      ok: true,
      active: false,
      message: 'nothing is playing right now',
    };
  }

  const positionSec = playback?.position_sec ?? 0;
  const durationSec = playback?.duration_sec ?? 0;
  const progressPct = durationSec > 0
    ? Math.round((positionSec / durationSec) * 100)
    : null;

  return {
    ok: true,
    active: mpvActive,
    type: session?.type ?? null,
    id: session?.play_id ?? null,
    title_id: session?.title_id ?? null,
    title: session?.title ?? null,
    poster: session?.poster ?? null,
    position_sec: positionSec,
    duration_sec: durationSec,
    progress_pct: progressPct,
  };
}

export function buildContinuePlayTarget(tab?: CatalogTab | null): Record<string, unknown> {
  const tabs: CatalogTab[] = tab ? [tab] : ['movies', 'series'];
  for (const candidateTab of tabs) {
    const items = listContinueItems(candidateTab, 1);
    if (items.length > 0) {
      const item = items[0];
      return {
        ok: true,
        found: true,
        tab: candidateTab,
        type: item.type,
        id: item.id,
        play_id: item.progress.play_id,
        title: item.title,
        subtitle: item.subtitle,
        progress_pct: item.progress.progress_pct,
      };
    }
  }
  return {
    ok: true,
    found: false,
    message: 'nothing in continue watching',
  };
}

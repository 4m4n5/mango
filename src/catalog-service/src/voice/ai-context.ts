import { buildNowPlayingResponse } from './now-playing.js';
import { activeWatchSession } from '../progress/watcher.js';
import { listAiCatalogSummaries, type AiCatalogSummary } from '../ai-catalogs/service.js';
import type { CatalogTab } from '../rails.js';

export type AiContextRail = {
  slot_id: string;
  rail_id: string;
  label: string;
  content_type: string;
};

export type AiRailsByTab = Record<CatalogTab, AiContextRail[]>;

/** Groups AI catalog summaries by tab for the per-turn voice "TV context" payload. */
export function groupAiCatalogsByTab(summaries: AiCatalogSummary[]): AiRailsByTab {
  const grouped: AiRailsByTab = { movies: [], series: [], live: [], youtube: [] };
  for (const summary of summaries) {
    grouped[summary.tab].push({
      slot_id: summary.slot_id,
      rail_id: summary.rail_id,
      label: summary.label,
      content_type: summary.content_type,
    });
  }
  return grouped;
}

/**
 * now-playing payload plus a `live_channel` flag when the active watch session
 * carries a live-tab signal. Kept separate from buildNowPlayingResponse() so the
 * existing /voice/now-playing shape is untouched.
 */
async function buildAiContextNowPlaying(): Promise<Record<string, unknown>> {
  const base = await buildNowPlayingResponse();
  const session = activeWatchSession();
  if (!session) {
    return base;
  }
  return {
    ...base,
    live_channel: session.tab === 'live' || session.type === 'tv',
  };
}

export async function buildAiContextResponse(): Promise<{
  ok: true;
  now_playing: Record<string, unknown>;
  ai_rails_by_tab: AiRailsByTab;
}> {
  const [nowPlaying, summaries] = await Promise.all([
    buildAiContextNowPlaying(),
    listAiCatalogSummaries(),
  ]);
  return {
    ok: true,
    now_playing: nowPlaying,
    ai_rails_by_tab: groupAiCatalogsByTab(summaries),
  };
}

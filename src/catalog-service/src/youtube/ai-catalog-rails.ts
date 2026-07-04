import { loadAiCatalogSlots, slotsForTab } from '../ai-catalogs/store.js';
import type { AiCatalogSlotFile } from '../ai-catalogs/types.js';
import { getYoutubeItem } from './db.js';
import type { YoutubeRail, YoutubeRailItem } from './types.js';

const YOUTUBE_AI_RAIL_LIMIT = 20;

function seedToRailItem(seed: { id: string; title?: string; poster?: string }): YoutubeRailItem | null {
  const cached = getYoutubeItem('video', seed.id);
  if (cached) {
    return { ...cached, score: 1, reason: null };
  }
  if (!seed.title) {
    return null;
  }
  return {
    id: seed.id,
    kind: 'video',
    title: seed.title,
    subtitle: 'YouTube',
    description: null,
    thumbnail: seed.poster || null,
    channel_id: null,
    channel_title: null,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: Date.now(),
    score: 1,
    reason: null,
  };
}

export async function buildYoutubeAiCatalogRails(): Promise<YoutubeRail[]> {
  const slots = slotsForTab(await loadAiCatalogSlots(), 'youtube');
  const rails: YoutubeRail[] = [];
  for (const slot of slots) {
    const seeds = (slot.seed_titles ?? [])
      .filter((seed) => seed.type === 'youtube_video')
      .slice(0, YOUTUBE_AI_RAIL_LIMIT);
    const items: YoutubeRailItem[] = [];
    for (const seed of seeds) {
      const item = seedToRailItem(seed);
      if (item) {
        items.push(item);
      }
    }
    if (items.length > 0) {
      rails.push({
        rail_id: `ai-${slot.slot_id}`,
        label: slot.label,
        items,
        cached: true,
        stale: false,
      });
    }
  }
  return rails;
}

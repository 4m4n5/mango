import { loadAiCatalogSlots, slotsForTab } from '../ai-catalogs/store.js';
import type { AiCatalogSlotFile, AiSeedTitle } from '../ai-catalogs/types.js';
import type { RailItem, RailItemsResponse } from '../core.js';

const LIVE_AI_RAIL_LIMIT = 20;

function seedToRailItem(seed: AiSeedTitle): RailItem | null {
  if (!seed.title) {
    return null;
  }
  return {
    id: seed.id,
    type: 'tv',
    title: seed.title,
    subtitle: 'live',
    poster: seed.poster || '',
    source: '',
  };
}

export async function buildLiveAiCatalogRails(): Promise<RailItemsResponse[]> {
  const slots = slotsForTab(await loadAiCatalogSlots(), 'live');
  const rails: RailItemsResponse[] = [];
  for (const slot of slots) {
    const seeds = (slot.seed_titles ?? [])
      .filter((seed) => seed.type === 'tv')
      .slice(0, LIVE_AI_RAIL_LIMIT);
    const items: RailItem[] = [];
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
        resolve_ms: 0,
        skipped: 0,
        playability: {
          displayed: items.length,
          verified_pool: items.length,
          pending: 0,
          low_water: false,
          session_id: 'live',
        },
      });
    }
  }
  return rails;
}

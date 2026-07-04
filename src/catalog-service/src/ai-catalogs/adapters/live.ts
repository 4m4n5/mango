import { CatalogError } from '../../catalog-errors.js';
import { readAiCatalogSlot } from '../store.js';
import { AI_CATALOG_RAIL_PREFIX, MAX_AI_SLOTS_PER_TAB } from '../types.js';
import { searchLiveChannelSeeds, topUpLiveSeeds } from '../../live/ai-catalog-seeds.js';
import type { CatalogCore } from '../../core.js';
import type { ComposeDeps, ComposeInput, ComposePlan } from '../compose.js';
import type { SourceAdapter } from './types.js';

function bareSlotId(railId: string): string {
  return railId.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? railId.slice(AI_CATALOG_RAIL_PREFIX.length)
    : railId;
}

export const liveAdapter: SourceAdapter = {
  id: 'live',
  resolvePlan: async (input: ComposeInput, _deps: ComposeDeps): Promise<ComposePlan> => {
    const query = input.theme?.trim() || input.label.trim();
    const seeds = await searchLiveChannelSeeds(query, 12);
    return {
      seed_titles: seeds,
      sources: [],
      llm_hints: {
        theme: query,
        updated_at: new Date().toISOString(),
      },
      catalogs_to_activate: [],
      fallback_level: 0,
      thematic_score: 80,
    };
  },
  topUp: async (_core: CatalogCore, railId: string) => {
    const slot = await readAiCatalogSlot(bareSlotId(railId));
    if (!slot) {
      throw new CatalogError(404, `unknown ai catalog slot: ${railId}`);
    }
    return topUpLiveSeeds(slot, _core);
  },
  maxCapacity: () => MAX_AI_SLOTS_PER_TAB,
};

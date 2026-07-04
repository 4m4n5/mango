import { loadYoutubeConfig } from './config.js';
import { YoutubeApiClient } from './api.js';
import { searchCachedYoutubeItems } from './db.js';
import type { YoutubeItem } from './types.js';
import { mergeSeedLists } from '../ai-catalogs/list-source.js';
import { writeAiCatalogSlot } from '../ai-catalogs/store.js';
import { AI_CATALOG_RAIL_PREFIX, type AiCatalogSlotFile, type AiSeedTitle } from '../ai-catalogs/types.js';
import { DEFAULT_PLAYABILITY_CONFIG } from '../rails.js';
import type { CatalogCore } from '../core.js';
import type { PlayabilityRailStatus } from '../playability/db.js';
import type { TopUpRailResult } from '../playability/top-up.js';
import { invalidateYoutubeDiscoveryRailsCache } from './service.js';

const MAX_YOUTUBE_SEEDS = 20;

function youtubeItemToSeed(item: YoutubeItem): AiSeedTitle {
  return {
    type: 'youtube_video',
    id: item.id,
    title: item.title,
    poster: item.thumbnail ?? undefined,
  };
}

function bareSlotId(railId: string): string {
  return railId.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? railId.slice(AI_CATALOG_RAIL_PREFIX.length)
    : railId;
}

function railIdForSlot(slotId: string): string {
  const bare = bareSlotId(slotId);
  return `${AI_CATALOG_RAIL_PREFIX}${bare}`;
}

function emptyPlayabilityStatus(railId: string): PlayabilityRailStatus {
  return {
    rail_id: railId,
    pool_depth: 0,
    verified_pool: 0,
    pending: 0,
    stale: 0,
    failed: 0,
    last_verified_at: null,
  };
}

export async function searchYoutubeSeeds(query: string, limit = 12): Promise<AiSeedTitle[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const config = loadYoutubeConfig();
  if (config.api_key) {
    try {
      const client = new YoutubeApiClient(config);
      const groups = await client.search(trimmed, { type: 'video', limit });
      return groups.videos.map(youtubeItemToSeed).slice(0, limit);
    } catch (error) {
      console.warn(
        `youtube ai-catalog API search failed, falling back to cache: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const cached = searchCachedYoutubeItems(trimmed, limit * 3).filter((item) => item.kind === 'video');
  return cached.map(youtubeItemToSeed).slice(0, limit);
}

export async function topUpYoutubeSeeds(
  slot: AiCatalogSlotFile,
  _core?: CatalogCore,
): Promise<TopUpRailResult> {
  const railId = railIdForSlot(slot.slot_id);
  const query = slot.llm_hints?.theme?.trim() || slot.label.trim();
  const beforeCount = slot.seed_titles?.length ?? 0;
  const before = emptyPlayabilityStatus(railId);
  before.verified_pool = beforeCount;

  const found = await searchYoutubeSeeds(query, 12);
  const merged = mergeSeedLists(slot.seed_titles ?? [], found);
  const capped = merged.slice(0, MAX_YOUTUBE_SEEDS);
  const afterCount = capped.length;

  if (afterCount > beforeCount) {
    await writeAiCatalogSlot({
      ...slot,
      seed_titles: capped,
      llm_hints: {
        ...(slot.llm_hints ?? {}),
        updated_at: new Date().toISOString(),
      },
    });
    invalidateYoutubeDiscoveryRailsCache();
    if (_core) {
      await _core.reloadAiCatalogRails();
    }
  }

  const after = emptyPlayabilityStatus(railId);
  after.verified_pool = afterCount;

  const minDisplay = DEFAULT_PLAYABILITY_CONFIG.min_display;
  return {
    rail_id: railId,
    label: slot.label,
    ok: afterCount >= minDisplay,
    candidate_limit: 12,
    pool_target: minDisplay,
    min_display: minDisplay,
    before,
    after,
    candidates_seen: found.length,
    linked_existing: 0,
    verified: afterCount - beforeCount,
    failed: 0,
    skipped_existing: 0,
    skipped_recent_failed: 0,
    exhausted: afterCount >= MAX_YOUTUBE_SEEDS,
    results: [],
  };
}

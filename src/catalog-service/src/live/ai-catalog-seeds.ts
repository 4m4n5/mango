import { readLiveRailsDiskCacheSync } from '../live-rails-cache.js';
import { searchableChannelText, type LiveChannelMeta } from '../live-rails.js';
import { scoreTitleMatch } from '../voice/search.js';
import { mergeSeedLists } from '../ai-catalogs/list-source.js';
import { writeAiCatalogSlot } from '../ai-catalogs/store.js';
import { AI_CATALOG_RAIL_PREFIX, type AiCatalogSlotFile, type AiSeedTitle } from '../ai-catalogs/types.js';
import { DEFAULT_PLAYABILITY_CONFIG } from '../rails.js';
import type { CatalogCore } from '../core.js';
import type { PlayabilityRailStatus } from '../playability/db.js';
import type { TopUpRailResult } from '../playability/top-up.js';
import { invalidateLiveTabRailCache } from './cache.js';
import type { RailItem } from '../core.js';

const MAX_LIVE_SEEDS = 20;

function liveChannelToSeed(channel: LiveChannelMeta): AiSeedTitle {
  return {
    type: 'tv',
    id: channel.id,
    title: channel.name,
    poster: channel.poster ?? undefined,
  };
}

function railItemToLiveChannelMeta(item: RailItem): LiveChannelMeta | null {
  if (item.type !== 'tv' || !item.title) {
    return null;
  }
  return {
    id: item.id,
    name: item.title,
    title: item.title,
    description: item.description,
    poster: item.poster || undefined,
  };
}

function bareSlotId(railId: string): string {
  return railId.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? railId.slice(AI_CATALOG_RAIL_PREFIX.length)
    : railId;
}

function railIdForSlot(slotId: string): string {
  return `${AI_CATALOG_RAIL_PREFIX}${bareSlotId(slotId)}`;
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

export function collectLiveChannelsFromCache(): LiveChannelMeta[] {
  return collectLiveSearchEntriesFromCache().map((entry) => entry.meta);
}

export type LiveSearchEntry = {
  meta: LiveChannelMeta;
  context?: string;
};

export function collectLiveSearchEntriesFromCache(): LiveSearchEntry[] {
  const diskCache = readLiveRailsDiskCacheSync();
  if (!diskCache || !Array.isArray(diskCache.payload.rails)) {
    return [];
  }
  const seen = new Set<string>();
  const entries: LiveSearchEntry[] = [];
  for (const rail of diskCache.payload.rails) {
    const railLabel = (rail as { label?: unknown }).label;
    const railText = typeof railLabel === 'string' && railLabel.trim() ? railLabel.trim() : '';
    const railItems = (rail as { items?: unknown }).items;
    if (!Array.isArray(railItems)) {
      continue;
    }
    for (const raw of railItems) {
      const item = railItemToLiveChannelMeta(raw as RailItem);
      if (!item || seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      entries.push({ meta: item, context: railText || undefined });
    }
  }
  return entries;
}

export async function searchLiveChannelSeeds(query: string, limit = 12): Promise<AiSeedTitle[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const diskCache = readLiveRailsDiskCacheSync();
  if (!diskCache || !Array.isArray(diskCache.payload.rails)) {
    return [];
  }

  const scored: { seed: AiSeedTitle; score: number }[] = [];
  for (const rail of diskCache.payload.rails) {
    const railLabel = (rail as { label?: unknown }).label;
    const railText = typeof railLabel === 'string' && railLabel.trim() ? railLabel.trim() : '';
    const railItems = (rail as { items?: unknown }).items;
    if (!Array.isArray(railItems)) {
      continue;
    }
    for (const raw of railItems) {
      const item = railItemToLiveChannelMeta(raw as RailItem);
      if (!item) {
        continue;
      }
      let text = searchableChannelText(item);
      if (railText) {
        text += ` ${railText}`;
      }
      const score = scoreTitleMatch(text, trimmed);
      if (score > 0) {
        scored.push({ seed: { ...liveChannelToSeed(item), score }, score });
      }
    }
  }

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, limit).map((entry) => entry.seed);
}

export async function topUpLiveSeeds(
  slot: AiCatalogSlotFile,
  _core?: CatalogCore,
): Promise<TopUpRailResult> {
  const railId = railIdForSlot(slot.slot_id);
  const query = slot.llm_hints?.theme?.trim() || slot.label.trim();
  const beforeCount = slot.seed_titles?.length ?? 0;
  const before = emptyPlayabilityStatus(railId);
  before.verified_pool = beforeCount;

  const found = await searchLiveChannelSeeds(query, 12);
  const merged = mergeSeedLists(slot.seed_titles ?? [], found);
  const capped = merged.slice(0, MAX_LIVE_SEEDS);
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
    if (_core) {
      invalidateLiveTabRailCache(_core);
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
    exhausted: afterCount >= MAX_LIVE_SEEDS,
    results: [],
  };
}

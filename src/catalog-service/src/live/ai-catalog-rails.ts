import { loadAiCatalogSlots, slotsForTab } from '../ai-catalogs/store.js';
import type { AiCatalogSlotFile, AiSeedTitle } from '../ai-catalogs/types.js';
import type { RailItem, RailItemsResponse, TabRailItemsResponse } from '../core.js';
import { canonicalLiveChannelKey } from './qualification.js';

const LIVE_AI_RAIL_LIMIT = 20;

/** Live AI slots merged into yaml sport rails instead of separate ai-* rows. */
export const LIVE_AI_MERGE_TARGETS: Readonly<Record<string, string>> = {
  'cricket-channels': 'live-cricket',
};

const LIVE_AI_MERGE_LIMITS: Readonly<Record<string, number>> = {
  'live-cricket': 12,
};

/** Explain seed-only Live slots on operator rail listings without a VOD probe. */
export function liveAiOperatorSummary(railId: string, seedCount: number): {
  seed_count: number;
  merge_target?: string;
} {
  const slotId = railId.startsWith('ai-') ? railId.slice(3) : railId;
  const mergeTarget = LIVE_AI_MERGE_TARGETS[slotId];
  return {
    seed_count: Math.max(0, seedCount),
    ...(mergeTarget ? { merge_target: mergeTarget } : {}),
  };
}

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

function itemsFromSlot(slot: AiCatalogSlotFile): RailItem[] {
  const items: RailItem[] = [];
  for (const seed of (slot.seed_titles ?? []).filter((entry) => entry.type === 'tv').slice(0, LIVE_AI_RAIL_LIMIT)) {
    const item = seedToRailItem(seed);
    if (item) {
      items.push(item);
    }
  }
  return items;
}

function playabilityForItems(items: RailItem[]) {
  return {
    displayed: items.length,
    verified_pool: items.length,
    pending: 0,
    low_water: false,
    session_id: 'live',
  };
}

export async function buildLiveAiCatalogRails(): Promise<RailItemsResponse[]> {
  const slots = slotsForTab(await loadAiCatalogSlots(), 'live');
  const rails: RailItemsResponse[] = [];
  for (const slot of slots) {
    if (LIVE_AI_MERGE_TARGETS[slot.slot_id]) {
      continue;
    }
    const items = itemsFromSlot(slot);
    if (items.length > 0) {
      rails.push({
        rail_id: `ai-${slot.slot_id}`,
        label: slot.label,
        items,
        resolve_ms: 0,
        skipped: 0,
        playability: playabilityForItems(items),
      });
    }
  }
  return rails;
}

function mergeItemsIntoRail(
  rail: RailItemsResponse,
  extras: RailItem[],
  limit = LIVE_AI_RAIL_LIMIT,
): RailItemsResponse {
  if (extras.length === 0) {
    return rail;
  }
  const seen = new Set(rail.items.map((item) => item.id));
  const seenTitles = new Set(
    rail.items.map((item) => canonicalLiveChannelKey({
      id: item.id,
      name: item.title,
      title: item.title,
    })).filter(Boolean),
  );
  const merged = [...rail.items];
  for (const item of extras) {
    if (merged.length >= limit) {
      break;
    }
    const titleKey = canonicalLiveChannelKey({
      id: item.id,
      name: item.title,
      title: item.title,
    });
    if (seen.has(item.id) || (titleKey && seenTitles.has(titleKey))) {
      continue;
    }
    seen.add(item.id);
    if (titleKey) seenTitles.add(titleKey);
    merged.push(item);
  }
  if (merged.length === rail.items.length) {
    return rail;
  }
  return {
    ...rail,
    items: merged.slice(0, limit),
    playability: playabilityForItems(merged.slice(0, limit)),
  };
}

export async function applyLiveAiCatalogRails(
  payload: TabRailItemsResponse,
): Promise<TabRailItemsResponse> {
  const slots = slotsForTab(await loadAiCatalogSlots(), 'live');
  const mergeByTarget = new Map<string, RailItem[]>();
  for (const slot of slots) {
    const targetRailId = LIVE_AI_MERGE_TARGETS[slot.slot_id];
    if (!targetRailId) {
      continue;
    }
    const items = itemsFromSlot(slot);
    if (items.length === 0) {
      continue;
    }
    const bucket = mergeByTarget.get(targetRailId) || [];
    bucket.push(...items);
    mergeByTarget.set(targetRailId, bucket);
  }

  let rails = payload.rails.map((rail) => {
    const extras = mergeByTarget.get(rail.rail_id);
    if (!extras?.length) {
      return rail;
    }
    const limit = LIVE_AI_MERGE_LIMITS[rail.rail_id] ?? LIVE_AI_RAIL_LIMIT;
    return mergeItemsIntoRail(rail, extras, limit);
  });

  const aiRails = await buildLiveAiCatalogRails();
  if (aiRails.length > 0) {
    const existing = new Set(rails.map((rail) => rail.rail_id));
    rails = [...rails, ...aiRails.filter((rail) => !existing.has(rail.rail_id))];
  }

  if (mergeByTarget.size === 0 && aiRails.length === 0) {
    return payload;
  }
  return { ...payload, rails };
}

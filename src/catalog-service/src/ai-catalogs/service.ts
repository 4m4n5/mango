import type { CatalogSourceRef, CatalogTab } from '../rails.js';
import { addUserPin } from '../user-pins.js';
import type { CatalogCore } from '../core.js';
import { CatalogError } from '../catalog-errors.js';
import { topUpRail } from '../playability/top-up.js';
import {
  deleteAiCatalogSlot,
  loadAiCatalogSlots,
  readAiCatalogSlot,
  slotsForTab,
  tabHasCapacity,
  writeAiCatalogSlot,
} from './store.js';
import { mergeSeedLists } from './list-source.js';
import { appendTopUpSuggestion, applyAiCatalogTopUpHints, clearAppliedTopUpHints } from './hints.js';
import type {
  AiCatalogLlmHints,
  AiCatalogOverflowOptions,
  AiCatalogSlotFile,
  AiSeedTitle,
} from './types.js';
import { AI_CATALOG_RAIL_PREFIX } from './types.js';

export type AiCatalogSummary = {
  slot_id: string;
  rail_id: string;
  tab: CatalogTab;
  label: string;
  content_type: string;
  seed_count: number;
  source_count: number;
  llm_hints: AiCatalogLlmHints;
  created_at?: string;
};

export type CreateAiCatalogInput = {
  label: string;
  tab: CatalogTab;
  content_type: 'movie' | 'series';
  seed_titles?: AiSeedTitle[];
  sources?: CatalogSourceRef[];
  llm_hints?: AiCatalogLlmHints;
  overflow_action?: 'replace' | 'pin_titles' | 'merge';
  replace_slot_id?: string;
  merge_into_slot_id?: string;
  pin_titles?: AiSeedTitle[];
};

function bareSlotId(value: string): string {
  return value.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? value.slice(AI_CATALOG_RAIL_PREFIX.length)
    : value;
}

function railIdForSlot(slotId: string): string {
  const bare = bareSlotId(slotId);
  return `${AI_CATALOG_RAIL_PREFIX}${bare}`;
}

export function slugifySlotId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'catalog';
}

async function uniqueSlotId(label: string): Promise<string> {
  const slots = await loadAiCatalogSlots();
  const base = slugifySlotId(label);
  let candidate = base;
  let suffix = 2;
  while (slots.some((slot) => slot.slot_id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function buildOverflowOptions(
  tab: CatalogTab,
  existing: AiCatalogSlotFile[],
  seedTitles: AiSeedTitle[],
): AiCatalogOverflowOptions {
  return {
    tab,
    replaceable_slots: existing.map((slot) => ({ slot_id: slot.slot_id, label: slot.label })),
    pin_merge_candidates: seedTitles,
    merge_target_slots: existing.map((slot) => ({ slot_id: slot.slot_id, label: slot.label })),
  };
}

export async function listAiCatalogSummaries(): Promise<AiCatalogSummary[]> {
  const slots = await loadAiCatalogSlots();
  return slots.map((slot) => ({
    slot_id: slot.slot_id,
    rail_id: railIdForSlot(slot.slot_id),
    tab: slot.tab,
    label: slot.label,
    content_type: slot.content_type,
    seed_count: slot.seed_titles?.length ?? 0,
    source_count: slot.sources?.length ?? 0,
    llm_hints: slot.llm_hints ?? {},
    created_at: (slot as AiCatalogSlotFile & { created_at?: string }).created_at,
  }));
}

async function pinTitles(tab: CatalogTab, titles: AiSeedTitle[]): Promise<number> {
  let pinned = 0;
  for (const title of titles) {
    await addUserPin({
      tab,
      type: title.type,
      id: title.id,
      title: title.title,
      poster: title.poster,
    });
    pinned += 1;
  }
  return pinned;
}

function mergeSourceRefs(
  left: CatalogSourceRef[],
  right: CatalogSourceRef[],
): CatalogSourceRef[] {
  const merged = new Map<string, CatalogSourceRef>();
  for (const source of [...left, ...right]) {
    merged.set(`${source.addon}:${source.catalog}`, { ...merged.get(`${source.addon}:${source.catalog}`), ...source });
  }
  return [...merged.values()];
}

async function mergeIntoExistingSlot(
  mergeIntoSlotId: string,
  incoming: {
    seed_titles: AiSeedTitle[];
    sources: CatalogSourceRef[];
    llm_hints?: AiCatalogLlmHints;
  },
): Promise<AiCatalogSlotFile> {
  const targetId = bareSlotId(mergeIntoSlotId);
  const target = await readAiCatalogSlot(targetId);
  if (!target) {
    throw new CatalogError(404, `unknown ai catalog slot: ${targetId}`);
  }
  const mergedHints = {
    ...(target.llm_hints ?? {}),
    ...(incoming.llm_hints ?? {}),
    topup_suggestions: [
      ...(target.llm_hints?.topup_suggestions ?? []),
      ...(incoming.llm_hints?.topup_suggestions ?? []),
    ].slice(-12),
    updated_at: new Date().toISOString(),
  };
  return writeAiCatalogSlot({
    ...target,
    seed_titles: mergeSeedLists(target.seed_titles ?? [], incoming.seed_titles),
    sources: mergeSourceRefs(target.sources ?? [], incoming.sources ?? []),
    llm_hints: mergedHints,
  });
}

export async function createAiCatalog(
  core: CatalogCore,
  input: CreateAiCatalogInput,
): Promise<{ ok: true; slot: AiCatalogSummary; overflow?: never } | {
  ok: false;
  error: 'tab_full';
  overflow_options: AiCatalogOverflowOptions;
}> {
  const tab = input.tab;
  if (tab !== 'movies' && tab !== 'series') {
    throw new CatalogError(400, 'ai catalog tab must be movies or series');
  }
  const seedTitles = input.seed_titles ?? [];
  const sources = input.sources ?? [];
  const existing = slotsForTab(await loadAiCatalogSlots(), tab);

  if (!tabHasCapacity(existing, tab)) {
    const action = input.overflow_action;
    if (!action) {
      return {
        ok: false,
        error: 'tab_full',
        overflow_options: buildOverflowOptions(tab, existing, seedTitles),
      };
    }

    if (action === 'pin_titles') {
      const toPin = input.pin_titles?.length ? input.pin_titles : seedTitles;
      if (toPin.length === 0) {
        throw new CatalogError(400, 'pin_titles overflow requires titles to pin');
      }
      const pinned = await pinTitles(tab, toPin);
      core.clearRailItemsCache();
      return {
        ok: true,
        slot: {
          slot_id: '',
          rail_id: '',
          tab,
          label: 'pinned overflow',
          content_type: input.content_type,
          seed_count: 0,
          source_count: 0,
          llm_hints: { topup_suggestions: [`pinned ${pinned} title(s) instead of new catalog`] },
        },
      };
    }

    if (action === 'merge') {
      const mergeId = input.merge_into_slot_id;
      if (!mergeId) {
        throw new CatalogError(400, 'merge overflow requires merge_into_slot_id');
      }
      const merged = await mergeIntoExistingSlot(mergeId, {
        seed_titles: seedTitles,
        sources,
        llm_hints: input.llm_hints,
      });
      await core.reloadAiCatalogRails();
      return {
        ok: true,
        slot: {
          slot_id: merged.slot_id,
          rail_id: railIdForSlot(merged.slot_id),
          tab: merged.tab,
          label: merged.label,
          content_type: merged.content_type,
          seed_count: merged.seed_titles?.length ?? 0,
          source_count: merged.sources?.length ?? 0,
          llm_hints: merged.llm_hints ?? {},
        },
      };
    }

    if (action === 'replace') {
      const replaceId = bareSlotId(input.replace_slot_id ?? '');
      if (!replaceId || !existing.some((slot) => slot.slot_id === replaceId)) {
        throw new CatalogError(400, 'replace overflow requires valid replace_slot_id');
      }
      await deleteAiCatalogSlot(replaceId);
    }
  }

  const slotId = await uniqueSlotId(input.label);
  const slot = await writeAiCatalogSlot({
    version: 1,
    slot_id: slotId,
    tab,
    label: input.label.trim(),
    content_type: input.content_type,
    enabled: true,
    sources,
    seed_titles: seedTitles,
    llm_hints: {
      ...(input.llm_hints ?? {}),
      updated_at: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
  } as AiCatalogSlotFile & { created_at: string });

  await core.reloadAiCatalogRails();
  return {
    ok: true,
    slot: {
      slot_id: slot.slot_id,
      rail_id: railIdForSlot(slot.slot_id),
      tab: slot.tab,
      label: slot.label,
      content_type: slot.content_type,
      seed_count: slot.seed_titles?.length ?? 0,
      source_count: slot.sources?.length ?? 0,
      llm_hints: slot.llm_hints ?? {},
      created_at: (slot as AiCatalogSlotFile & { created_at?: string }).created_at,
    },
  };
}

export type UpdateAiCatalogInput = {
  slot_id: string;
  label?: string;
  seed_titles?: AiSeedTitle[];
  sources?: CatalogSourceRef[];
  llm_hints?: AiCatalogLlmHints;
  append_seeds?: AiSeedTitle[];
  remove_seed_ids?: string[];
};

export async function updateAiCatalog(
  core: CatalogCore,
  input: UpdateAiCatalogInput,
): Promise<AiCatalogSummary> {
  const slotId = bareSlotId(input.slot_id);
  const existing = await readAiCatalogSlot(slotId);
  if (!existing) {
    throw new CatalogError(404, `unknown ai catalog slot: ${slotId}`);
  }

  let seedTitles = existing.seed_titles ?? [];
  if (input.seed_titles) {
    seedTitles = input.seed_titles;
  }
  if (input.append_seeds?.length) {
    seedTitles = mergeSeedLists(seedTitles, input.append_seeds);
  }
  if (input.remove_seed_ids?.length) {
    const remove = new Set(input.remove_seed_ids.map((id) => id.trim()).filter(Boolean));
    seedTitles = seedTitles.filter((seed) => !remove.has(seed.id));
  }

  const slot = await writeAiCatalogSlot({
    ...existing,
    label: input.label?.trim() || existing.label,
    sources: input.sources ?? existing.sources,
    seed_titles: seedTitles,
    llm_hints: input.llm_hints
      ? { ...existing.llm_hints, ...input.llm_hints, updated_at: new Date().toISOString() }
      : existing.llm_hints,
  });

  await core.reloadAiCatalogRails();
  return {
    slot_id: slot.slot_id,
    rail_id: railIdForSlot(slot.slot_id),
    tab: slot.tab,
    label: slot.label,
    content_type: slot.content_type,
    seed_count: slot.seed_titles?.length ?? 0,
    source_count: slot.sources?.length ?? 0,
    llm_hints: slot.llm_hints ?? {},
  };
}

export async function deleteAiCatalog(
  core: CatalogCore,
  slotIdInput: string,
): Promise<boolean> {
  const slotId = bareSlotId(slotIdInput);
  const removed = await deleteAiCatalogSlot(slotId);
  if (removed) {
    await core.reloadAiCatalogRails();
    core.clearRailItemsCache();
  }
  return removed;
}

export async function refreshAiCatalog(
  core: CatalogCore,
  slotIdInput: string,
): Promise<Record<string, unknown>> {
  const slotId = bareSlotId(slotIdInput);
  const slot = await readAiCatalogSlot(slotId);
  if (!slot) {
    throw new CatalogError(404, `unknown ai catalog slot: ${slotId}`);
  }
  const railId = railIdForSlot(slotId);
  const rail = core.browsableRail(railId);
  if (rail.type !== 'ai_catalog') {
    throw new CatalogError(500, `expected ai catalog rail: ${railId}`);
  }
  await applyAiCatalogTopUpHints(rail);
  const result = await topUpRail(core, railId);
  await clearAppliedTopUpHints(railId);
  core.clearRailItemsCache(railId);
  return {
    ok: result.ok,
    rail_id: railId,
    label: slot.label,
    top_up: result,
  };
}

export async function suggestAiCatalogTopUp(
  core: CatalogCore,
  slotIdInput: string,
  suggestion: string,
): Promise<AiCatalogSummary> {
  const slotId = bareSlotId(slotIdInput);
  const existing = await readAiCatalogSlot(slotId);
  if (!existing) {
    throw new CatalogError(404, `unknown ai catalog slot: ${slotId}`);
  }
  const slot = await writeAiCatalogSlot({
    ...existing,
    llm_hints: appendTopUpSuggestion(existing.llm_hints ?? {}, suggestion),
  });
  await core.reloadAiCatalogRails();
  return {
    slot_id: slot.slot_id,
    rail_id: railIdForSlot(slot.slot_id),
    tab: slot.tab,
    label: slot.label,
    content_type: slot.content_type,
    seed_count: slot.seed_titles?.length ?? 0,
    source_count: slot.sources?.length ?? 0,
    llm_hints: slot.llm_hints ?? {},
  };
}

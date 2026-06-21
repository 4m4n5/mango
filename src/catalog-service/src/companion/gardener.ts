import { loadAiCatalogSlots, readAiCatalogSlot, writeAiCatalogSlot } from '../ai-catalogs/store.js';
import { appendTopUpSuggestion } from '../ai-catalogs/hints.js';
import type { AiCatalogLlmHints, AiCatalogSlotFile } from '../ai-catalogs/types.js';
import type { CompanionProfile, TitleRef } from './types.js';
import { readProfile } from './profile.js';
import { appendJournalEvent } from './journal.js';

export const MAX_GARDENER_ADD_IDS = 5;
export const MAX_GARDENER_SUGGESTIONS_PER_SLOT = 2;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3),
  );
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

export function scoreSlotAffinity(profile: CompanionProfile, slot: AiCatalogSlotFile): number {
  const labelTokens = tokenize(`${slot.label} ${slot.llm_hints?.theme ?? ''}`);
  let score = 0;

  for (const love of profile.taste.loves) {
    score += overlapScore(tokenize(love), labelTokens) * 2;
  }
  for (const avoid of profile.taste.avoids) {
    score -= overlapScore(tokenize(avoid), labelTokens) * 3;
  }
  for (const fact of profile.facts.slice(-8)) {
    score += overlapScore(tokenize(fact), labelTokens);
  }

  return score;
}

export function buildTopUpSuggestions(
  profile: CompanionProfile,
  slot: AiCatalogSlotFile,
): string[] {
  const suggestions: string[] = [];
  const labelTokens = tokenize(`${slot.label} ${slot.llm_hints?.theme ?? ''}`);
  const unmatchedLoves = profile.taste.loves.filter(
    (love) => overlapScore(tokenize(love), labelTokens) === 0,
  );

  if (unmatchedLoves.length > 0) {
    suggestions.push(
      `Consider ${unmatchedLoves.slice(0, 3).join(', ')} titles for "${slot.label}"`,
    );
  }

  if (profile.taste.avoids.length > 0) {
    suggestions.push(
      `Deprioritize ${profile.taste.avoids.slice(0, 3).join(', ')} on this rail`,
    );
  }

  return suggestions.slice(0, MAX_GARDENER_SUGGESTIONS_PER_SLOT);
}

export function assignTitleLovesToSlots(
  profile: CompanionProfile,
  slots: AiCatalogSlotFile[],
): Map<string, string[]> {
  const assignments = new Map<string, string[]>();
  for (const slot of slots) {
    assignments.set(slot.slot_id, []);
  }

  const rankedSlots = [...slots].sort(
    (a, b) => scoreSlotAffinity(profile, b) - scoreSlotAffinity(profile, a),
  );

  for (const title of profile.taste.title_loves) {
    const target = pickSlotForTitle(title, rankedSlots);
    if (!target) continue;
    const ids = assignments.get(target.slot_id) ?? [];
    if (ids.length >= MAX_GARDENER_ADD_IDS) continue;
    if (!ids.includes(title.id)) {
      ids.push(title.id);
      assignments.set(target.slot_id, ids);
    }
  }

  return assignments;
}

function pickSlotForTitle(title: TitleRef, slots: AiCatalogSlotFile[]): AiCatalogSlotFile | null {
  const type = title.type === 'series' ? 'series' : 'movie';
  const candidates = slots.filter((slot) => slot.content_type === type);
  if (candidates.length === 0) return null;
  if (title.title) {
    const titleTokens = tokenize(title.title);
    let best: { slot: AiCatalogSlotFile; score: number } | null = null;
    for (const slot of candidates) {
      const score = overlapScore(titleTokens, tokenize(`${slot.label} ${slot.llm_hints?.theme ?? ''}`));
      if (!best || score > best.score) {
        best = { slot, score };
      }
    }
    if (best && best.score > 0) return best.slot;
  }
  return candidates[0] ?? null;
}

export function mergeGardenerHints(
  existing: AiCatalogLlmHints | undefined,
  incoming: {
    add_ids?: string[];
    topup_suggestions?: string[];
    theme?: string;
  },
): AiCatalogLlmHints {
  let hints: AiCatalogLlmHints = { ...(existing ?? {}) };
  if (incoming.theme && !hints.theme) {
    hints = { ...hints, theme: incoming.theme };
  }

  const mergedAdd = [...(hints.add_ids ?? [])];
  for (const id of incoming.add_ids ?? []) {
    if (!mergedAdd.includes(id)) mergedAdd.push(id);
  }
  hints.add_ids = mergedAdd.slice(-MAX_GARDENER_ADD_IDS);

  for (const suggestion of incoming.topup_suggestions ?? []) {
    hints = appendTopUpSuggestion(hints, suggestion) ?? hints;
  }

  return {
    ...hints,
    remove_ids: hints.remove_ids ?? [],
    updated_at: new Date().toISOString(),
  };
}

export type GardenerResult = {
  ok: true;
  slots_updated: number;
  details: Array<{ slot_id: string; add_ids: number; suggestions: number; affinity: number }>;
};

export async function applyCompanionGardener(
  profileInput?: CompanionProfile,
): Promise<GardenerResult> {
  const profile = profileInput ?? await readProfile();
  const slots = await loadAiCatalogSlots();
  if (slots.length === 0) {
    return { ok: true, slots_updated: 0, details: [] };
  }

  const addAssignments = assignTitleLovesToSlots(profile, slots);
  const details: GardenerResult['details'] = [];
  let slotsUpdated = 0;

  for (const slot of slots) {
    const affinity = scoreSlotAffinity(profile, slot);
    const addIds = addAssignments.get(slot.slot_id) ?? [];
    const suggestions = buildTopUpSuggestions(profile, slot);
    if (addIds.length === 0 && suggestions.length === 0) {
      continue;
    }

    const existing = await readAiCatalogSlot(slot.slot_id);
    if (!existing) continue;

    const llm_hints = mergeGardenerHints(existing.llm_hints, {
      add_ids: addIds,
      topup_suggestions: suggestions,
      theme: profile.taste.loves.slice(0, 2).join(', ') || undefined,
    });

    await writeAiCatalogSlot({ ...existing, llm_hints });
    slotsUpdated += 1;
    details.push({
      slot_id: slot.slot_id,
      add_ids: addIds.length,
      suggestions: suggestions.length,
      affinity,
    });
  }

  appendJournalEvent('catalog_gardener', {
    slots_updated: slotsUpdated,
    details,
  });

  return { ok: true, slots_updated: slotsUpdated, details };
}

/** Gardener must never write remove_ids autonomously. */
export function gardenerHintsAreSafe(hints: AiCatalogLlmHints | undefined): boolean {
  return !hints?.remove_ids?.length;
}

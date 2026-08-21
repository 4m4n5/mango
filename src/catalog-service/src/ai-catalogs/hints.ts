import { deleteRailPoolTitle } from '../playability/db.js';
import type { AiCatalogRail } from './types.js';
import { readAiCatalogSlot, writeAiCatalogSlot } from './store.js';
import { AI_CATALOG_RAIL_PREFIX } from './types.js';

function bareSlotId(railId: string): string {
  return railId.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? railId.slice(AI_CATALOG_RAIL_PREFIX.length)
    : railId;
}

export async function applyAiCatalogTopUpHints(rail: AiCatalogRail): Promise<{ removed: number }> {
  const removeIds = rail.llm_hints?.remove_ids ?? [];
  if (removeIds.length === 0) {
    return { removed: 0 };
  }

  let removed = 0;
  for (const id of removeIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    await deleteRailPoolTitle(rail.id, rail.content_type, trimmed);
    removed += 1;
  }
  return { removed };
}

export async function clearAppliedTopUpHints(railId: string): Promise<void> {
  const slot = await readAiCatalogSlot(bareSlotId(railId));
  if (!slot?.llm_hints?.remove_ids?.length) {
    return;
  }
  await writeAiCatalogSlot({
    ...slot,
    llm_hints: {
      ...slot.llm_hints,
      remove_ids: [],
      updated_at: new Date().toISOString(),
    },
  });
}

export function appendTopUpSuggestion(
  hints: AiCatalogRail['llm_hints'],
  suggestion: string,
): AiCatalogRail['llm_hints'] {
  const trimmed = suggestion.trim();
  if (!trimmed) {
    return hints;
  }
  const existing = hints.topup_suggestions ?? [];
  if (existing.includes(trimmed)) {
    return hints;
  }
  return {
    ...hints,
    topup_suggestions: [...existing, trimmed].slice(-12),
    updated_at: new Date().toISOString(),
  };
}

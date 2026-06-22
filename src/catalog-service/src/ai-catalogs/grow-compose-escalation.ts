import type { CatalogSourceRef } from '../rails.js';
import type { CatalogCore } from '../core.js';
import { resetRailIngestCursors } from '../playability/db.js';
import { searchExternalTitles } from '../voice/external.js';
import { searchVerifiedLibrary } from '../voice/search.js';
import { ensureCatalogsActive } from './catalog-activate.js';
import { resolveAiCatalogPlan } from './compose.js';
import { mergeSeedLists } from './list-source.js';
import { updateAiCatalog } from './service.js';
import { readAiCatalogSlot } from './store.js';
import type { AiCatalogRail } from './types.js';
import { AI_CATALOG_RAIL_PREFIX } from './types.js';

export const MAX_COMPOSE_FALLBACK = 3;

export type GrowComposeEscalationResult =
  | {
    applied: true;
    fallback_level: number;
    thematic_score: number;
  }
  | {
    applied: false;
    reason: 'max_fallback' | 'compose_failed' | 'unchanged';
  };

function slotIdFromRail(railId: string): string {
  return railId.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? railId.slice(AI_CATALOG_RAIL_PREFIX.length)
    : railId;
}

export function nextComposeFallbackLevel(current: number): number | null {
  if (current >= MAX_COMPOSE_FALLBACK) {
    return null;
  }
  return current + 1;
}

export function sourcesSignature(sources: CatalogSourceRef[]): string {
  return sources
    .map((source) => `${source.addon}:${source.catalog}:${source.weight ?? 1}`)
    .sort()
    .join('|');
}

export async function tryGrowComposeEscalation(
  core: CatalogCore,
  rail: AiCatalogRail,
): Promise<GrowComposeEscalationResult> {
  const slot = await readAiCatalogSlot(slotIdFromRail(rail.id));
  if (!slot) {
    return { applied: false, reason: 'compose_failed' };
  }

  const currentLevel = slot.llm_hints?.compose_fallback_level ?? 0;
  const nextLevel = nextComposeFallbackLevel(currentLevel);
  if (nextLevel === null) {
    return { applied: false, reason: 'max_fallback' };
  }

  let plan;
  try {
    plan = await resolveAiCatalogPlan(
      {
        label: slot.label,
        tab: slot.tab,
        content_type: slot.content_type,
        theme: slot.llm_hints?.theme,
        seed_hints: slot.seed_titles,
      },
      {
        searchLibrary: searchVerifiedLibrary,
        searchExternal: async (query, limit = 8) => {
          const response = await searchExternalTitles(core, query, {
            type: slot.content_type,
            limit,
            queue_missing: true,
          });
          return response.results;
        },
        minFallbackLevel: nextLevel,
      },
    );
  } catch {
    return { applied: false, reason: 'compose_failed' };
  }

  const previousSources = slot.sources ?? [];
  const mergedSeeds = mergeSeedLists(slot.seed_titles ?? [], plan.seed_titles);
  const seedsChanged = mergedSeeds.length > (slot.seed_titles?.length ?? 0);
  const sourcesChanged = sourcesSignature(plan.sources) !== sourcesSignature(previousSources);
  if (!sourcesChanged && !seedsChanged) {
    return { applied: false, reason: 'unchanged' };
  }

  if (plan.catalogs_to_activate.length > 0) {
    await ensureCatalogsActive(plan.catalogs_to_activate);
  }

  await updateAiCatalog(core, {
    slot_id: slot.slot_id,
    sources: plan.sources,
    seed_titles: mergedSeeds,
    llm_hints: {
      ...slot.llm_hints,
      ...plan.llm_hints,
      theme: plan.llm_hints.theme ?? slot.llm_hints?.theme,
      compose_fallback_level: nextLevel,
      topup_suggestions: [
        ...(slot.llm_hints?.topup_suggestions ?? []),
        ...(plan.llm_hints.topup_suggestions ?? []),
      ].slice(-12),
      updated_at: new Date().toISOString(),
    },
  });

  await resetRailIngestCursors(rail.id);
  await core.reloadAiCatalogRails();

  if (process.env.MANGO_OPS_LOG_BOOTSTRAP !== '0') {
    const { recordAiCatalogOps } = await import('../ops/record.js');
    recordAiCatalogOps(
      'ai_catalog_refresh',
      `${slot.slot_id}: grow compose fallback ${currentLevel}→${nextLevel}`,
      {
        slot_id: slot.slot_id,
        rail_id: rail.id,
        fallback_level: nextLevel,
        thematic_score: plan.thematic_score,
        sources: plan.sources.map((source) => source.catalog),
        seed_count: mergedSeeds.length,
      },
    );
  }

  return {
    applied: true,
    fallback_level: nextLevel,
    thematic_score: plan.thematic_score,
  };
}

import { randomUUID } from 'node:crypto';
import type { CatalogTab } from '../rails.js';
import type { CatalogCore } from '../core.js';
import { DEFAULT_PLAYABILITY_CONFIG } from '../rails.js';
import { getRailPlayabilityStatus } from '../playability/db.js';
import { topUpRail } from '../playability/top-up.js';
import { ensureCatalogsActive } from './catalog-activate.js';
import { resolveAiCatalogPlan, type ComposeInput } from './compose.js';
import {
  createAiCatalog,
  refreshAiCatalog,
  updateAiCatalog,
  type CreateAiCatalogInput,
} from './service.js';
import { readAiCatalogSlot } from './store.js';
import { applyAiCatalogTopUpHints, clearAppliedTopUpHints } from './hints.js';
import { AI_CATALOG_RAIL_PREFIX } from './types.js';
import { searchExternalTitles } from '../voice/external.js';
import { searchVerifiedLibrary } from '../voice/search.js';

export type BootstrapStatus = 'queued' | 'running' | 'ready' | 'failed';

export type BootstrapJobRecord = {
  job_id: string;
  slot_id: string;
  rail_id: string;
  tab: CatalogTab;
  status: BootstrapStatus;
  visible_on_tab: boolean;
  verified_pool: number;
  displayed: number;
  thematic_score: number;
  fallback_level: number;
  message: string;
  started_at: string;
  finished_at?: string;
  error?: string;
};

const jobs = new Map<string, BootstrapJobRecord>();
const latestJobBySlot = new Map<string, string>();

const JOB_TIMEOUT_MS = Number(process.env.MANGO_AI_CATALOG_BOOTSTRAP_TIMEOUT_MS ?? 120_000);
const SYNC_BOOTSTRAP = process.env.MANGO_AI_CATALOG_SYNC_BOOTSTRAP === '1';

function railIdForSlot(slotId: string): string {
  return `${AI_CATALOG_RAIL_PREFIX}${slotId}`;
}

function minDisplay(): number {
  return DEFAULT_PLAYABILITY_CONFIG.min_display;
}

async function checkVisibleOnTab(
  core: CatalogCore,
  tab: CatalogTab,
  railId: string,
): Promise<{ visible: boolean; displayed: number }> {
  const batch = await core.tabRailItems(tab, { reshuffle: true });
  const rail = batch.rails.find((entry) => entry.rail_id === railId);
  const displayed = rail?.items.length ?? 0;
  return {
    visible: displayed >= minDisplay(),
    displayed,
  };
}

async function runTopUpRound(core: CatalogCore, railId: string): Promise<boolean> {
  const rail = core.browsableRail(railId);
  if (rail.type === 'ai_catalog') {
    await applyAiCatalogTopUpHints(rail);
    await core.reloadAiCatalogRails();
  }
  const result = await topUpRail(core, railId);
  await clearAppliedTopUpHints(railId);
  core.clearRailItemsCache(railId);
  return result.ok;
}

async function logBootstrapJob(job: BootstrapJobRecord): Promise<void> {
  if (process.env.MANGO_OPS_LOG_BOOTSTRAP === '0') return;
  const { recordAiCatalogOps } = await import('../ops/record.js');
  recordAiCatalogOps(
    'ai_catalog_bootstrap',
    `${job.slot_id}: ${job.status} pool=${job.verified_pool} displayed=${job.displayed} visible=${job.visible_on_tab}`,
    {
      job_id: job.job_id,
      slot_id: job.slot_id,
      rail_id: job.rail_id,
      tab: job.tab,
      status: job.status,
      visible_on_tab: job.visible_on_tab,
      verified_pool: job.verified_pool,
      displayed: job.displayed,
      thematic_score: job.thematic_score,
      fallback_level: job.fallback_level,
      message: job.message,
      error: job.error,
      started_at: job.started_at,
      finished_at: job.finished_at,
    },
  );
}

export async function runBootstrapJob(core: CatalogCore, jobId: string): Promise<BootstrapJobRecord> {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error(`unknown bootstrap job: ${jobId}`);
  }

  job.status = 'running';
  job.message = `Building ${job.slot_id} rail…`;
  const deadline = Date.now() + JOB_TIMEOUT_MS;

  try {
    const slot = await readAiCatalogSlot(job.slot_id);
    if (!slot) {
      throw new Error(`slot missing: ${job.slot_id}`);
    }

    job.thematic_score = job.thematic_score || 0;
    job.fallback_level = job.fallback_level || 0;

    const catalogsToActivate = (slot.sources ?? [])
      .filter((source) => source.addon === 'AIOMetadata' && source.catalog.startsWith('mdblist.'))
      .map((source) => source.catalog);
    if (catalogsToActivate.length > 0) {
      const activation = await ensureCatalogsActive(catalogsToActivate);
      if (!activation.ok) {
        job.message = 'Catalog import pending — filling from seeds…';
      }
    }

    let fallbackLevel = job.fallback_level;
    while (Date.now() < deadline) {
      const pool = await getRailPlayabilityStatus(job.rail_id);
      job.verified_pool = pool.verified_pool;

      const visibility = await checkVisibleOnTab(core, job.tab, job.rail_id);
      job.displayed = visibility.displayed;
      job.visible_on_tab = visibility.visible;
      if (visibility.visible) {
        job.status = 'ready';
        job.message = `${slot.label} rail is ready on ${job.tab} tab — shuffle to see it`;
        job.finished_at = new Date().toISOString();
        await logBootstrapJob(job);
        return job;
      }

      const toppedUp = await runTopUpRound(core, job.rail_id);
      if (toppedUp) {
        const after = await checkVisibleOnTab(core, job.tab, job.rail_id);
        job.displayed = after.displayed;
        job.visible_on_tab = after.visible;
        if (after.visible) {
          job.status = 'ready';
          job.message = `${slot.label} rail is ready on ${job.tab} tab — shuffle to see it`;
          job.finished_at = new Date().toISOString();
          await logBootstrapJob(job);
          return job;
        }
      }

      if (fallbackLevel >= 3) {
        break;
      }
      fallbackLevel += 1;
      const plan = await resolveAiCatalogPlan(
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
          minFallbackLevel: fallbackLevel,
        },
      );
      await updateAiCatalog(core, {
        slot_id: job.slot_id,
        sources: plan.sources,
        seed_titles: plan.seed_titles,
        llm_hints: plan.llm_hints,
      });
      job.fallback_level = fallbackLevel;
      job.thematic_score = plan.thematic_score;
    }

    const finalVisibility = await checkVisibleOnTab(core, job.tab, job.rail_id);
    job.displayed = finalVisibility.displayed;
    job.visible_on_tab = finalVisibility.visible;
    if (finalVisibility.visible) {
      job.status = 'ready';
      job.message = `${slot.label} rail is ready on ${job.tab} tab`;
    } else {
      job.status = 'failed';
      job.error = `pool=${job.verified_pool} displayed=${job.displayed} min=${minDisplay()}`;
      job.message = `${slot.label} rail is still filling — try shuffle again in a minute`;
    }
    job.finished_at = new Date().toISOString();
    await logBootstrapJob(job);
    return job;
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    job.message = `Bootstrap failed for ${job.slot_id}`;
    job.finished_at = new Date().toISOString();
    await logBootstrapJob(job);
    return job;
  }
}

export function enqueueBootstrapJob(
  core: CatalogCore,
  slotId: string,
  tab: CatalogTab,
  meta: { thematic_score: number; fallback_level: number },
): string {
  const jobId = randomUUID();
  const record: BootstrapJobRecord = {
    job_id: jobId,
    slot_id: slotId,
    rail_id: railIdForSlot(slotId),
    tab,
    status: 'queued',
    visible_on_tab: false,
    verified_pool: 0,
    displayed: 0,
    thematic_score: meta.thematic_score,
    fallback_level: meta.fallback_level,
    message: `Queued bootstrap for ${slotId}`,
    started_at: new Date().toISOString(),
  };
  jobs.set(jobId, record);
  latestJobBySlot.set(slotId, jobId);

  const run = async () => {
    await runBootstrapJob(core, jobId);
  };
  if (SYNC_BOOTSTRAP) {
    void run();
  } else {
    setImmediate(() => {
      void run();
    });
  }
  return jobId;
}

export function getBootstrapJob(jobId: string): BootstrapJobRecord | null {
  return jobs.get(jobId) ?? null;
}

export function getSlotBootstrapStatus(slotId: string): BootstrapJobRecord | null {
  const jobId = latestJobBySlot.get(slotId);
  if (!jobId) {
    return null;
  }
  return jobs.get(jobId) ?? null;
}

import type { AiCatalogSummary } from './service.js';

export type CreateWithBootstrapResult =
  | { ok: false; error: 'tab_full'; overflow_options: unknown }
  | {
    ok: true;
    catalog: AiCatalogSummary;
    bootstrap: {
      job_id: string;
      status: BootstrapStatus;
      visible_on_tab: boolean;
      message: string;
    };
  };

function allowAgentSources(): boolean {
  return process.env.MANGO_AI_CATALOG_ALLOW_AGENT_SOURCES === '1';
}

export async function composeCreateInput(
  core: CatalogCore,
  input: CreateAiCatalogInput & { theme?: string },
): Promise<CreateAiCatalogInput> {
  const theme = input.theme?.trim()
    || input.llm_hints?.theme?.trim()
    || input.label.trim();
  const hasAgentSources = allowAgentSources() && (input.sources?.length ?? 0) > 0;
  const hasSeeds = (input.seed_titles?.length ?? 0) > 0;
  if (hasAgentSources && hasSeeds) {
    return input;
  }

  const plan = await resolveAiCatalogPlan(
    {
      label: input.label,
      tab: input.tab,
      content_type: input.content_type,
      theme,
      seed_hints: input.seed_titles,
    },
    {
      searchLibrary: searchVerifiedLibrary,
      searchExternal: async (query, limit = 8) => {
        const response = await searchExternalTitles(core, query, {
          type: input.content_type,
          limit,
          queue_missing: true,
        });
        return response.results;
      },
    },
  );

  return {
    ...input,
    seed_titles: plan.seed_titles,
    sources: plan.sources,
    llm_hints: {
      ...(input.llm_hints ?? {}),
      ...plan.llm_hints,
      theme: plan.llm_hints.theme ?? theme,
    },
  };
}

export async function createAiCatalogWithBootstrap(
  core: CatalogCore,
  input: CreateAiCatalogInput & { theme?: string },
): Promise<CreateWithBootstrapResult> {
  const composed = await composeCreateInput(core, input);
  const result = await createAiCatalog(core, composed);
  if (!result.ok) {
    return result;
  }

  const jobId = enqueueBootstrapJob(core, result.slot.slot_id, result.slot.tab, {
    thematic_score: 0,
    fallback_level: 0,
  });
  const job = getBootstrapJob(jobId);
  return {
    ok: true,
    catalog: result.slot,
    bootstrap: {
      job_id: jobId,
      status: job?.status ?? 'queued',
      visible_on_tab: job?.visible_on_tab ?? false,
      message: job?.message ?? 'Bootstrap queued',
    },
  };
}

export async function migrateSlotIfEmpty(core: CatalogCore, slotId: string): Promise<boolean> {
  const slot = await readAiCatalogSlot(slotId);
  if (!slot) {
    return false;
  }
  const railId = railIdForSlot(slotId);
  const pool = await getRailPlayabilityStatus(railId);
  const needsCompose = (slot.seed_titles?.length ?? 0) === 0 && (slot.sources?.length ?? 0) === 0;
  const needsPool = pool.verified_pool < minDisplay();
  if (!needsCompose && !needsPool) {
    return false;
  }

  if (needsCompose) {
    const composed = await composeCreateInput(core, {
      label: slot.label,
      tab: slot.tab,
      content_type: slot.content_type,
      theme: slot.llm_hints?.theme,
    });
    await updateAiCatalog(core, {
      slot_id: slotId,
      sources: composed.sources,
      seed_titles: composed.seed_titles,
      llm_hints: composed.llm_hints,
    });
  }

  enqueueBootstrapJob(core, slotId, slot.tab, { thematic_score: 0, fallback_level: 0 });
  return true;
}

export async function refreshAiCatalogWithMigrate(
  core: CatalogCore,
  slotIdInput: string,
): Promise<Record<string, unknown>> {
  const slotId = slotIdInput.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? slotIdInput.slice(AI_CATALOG_RAIL_PREFIX.length)
    : slotIdInput;
  await migrateSlotIfEmpty(core, slotId);
  return refreshAiCatalog(core, slotId);
}

export type { ComposeInput };

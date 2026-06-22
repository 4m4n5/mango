import type { CatalogCore } from '../core.js';
import type { BrowsableRail } from '../rails.js';
import {
  getRailIngestOffsetsBulk,
  getRailPlayabilityStatus,
  getRailPoolTitleKeys,
  getTitlesPlayabilityBulk,
  pruneNonPlayableFromRailPools,
  setRailIngestOffset,
  type PlayabilityRailStatus,
} from './db.js';
import {
  ingestPaginatedCandidates,
  type IngestCandidatesStats,
} from './candidate-ingest.js';
import {
  candidateKey,
  createVerifyContext,
  finalizeVerifyContext,
  linkExistingVerifiedCandidates,
  processVerifyQueue,
  railMapsFromRails,
  type RailCandidateRef,
} from './pipeline.js';
import {
  playabilityFreshPerRail,
  playabilityIngestPageSize,
  playabilityMaxIngestScan,
  growIngestFreshTarget,
  playabilityGrowSourceAdvancePages,
  playabilityGrowSourceResetCycles,
} from './config.js';
import {
  createGrowthPassState,
  type GrowthPassState,
} from './pool-growth.js';
import {
  resolveGrowPreset,
  resolveGrowTarget,
  type GrowPresetId,
} from './grow-target.js';
import {
  loadSourceOffsetsForListSource,
  persistSourceOffsetsForListSource,
  isSourceCursorListSource,
} from './source-cursors.js';
import { applyAiCatalogTopUpHints, clearAppliedTopUpHints } from '../ai-catalogs/hints.js';
import { tryGrowComposeEscalation } from '../ai-catalogs/grow-compose-escalation.js';
import type { AiCatalogRail } from '../ai-catalogs/types.js';

export type GrowRailResult = {
  rail_id: string;
  label: string;
  ok: boolean;
  grow_target: number;
  probe_verified: number;
  pool_growth: number;
  grow_target_met: boolean;
  /** @deprecated Use grow_target — kept for one release. */
  growth_quota?: number;
  /** @deprecated Use probe_verified — kept for one release. */
  verified_added?: number;
  /** @deprecated Use grow_target_met — kept for one release. */
  growth_quota_met?: boolean;
  pool_target: number;
  candidate_limit: number;
  attempts: number;
  min_display: number;
  before: PlayabilityRailStatus;
  after: PlayabilityRailStatus;
  candidates_seen: number;
  linked_existing: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  exhausted: boolean;
  grow_loops: number;
  compose_escalated?: boolean;
  compose_fallback_level?: number;
  sources_touched?: number;
  ingest?: IngestCandidatesStats;
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: 'linked_existing' | 'verified' | 'failed' | 'skipped_existing' | 'skipped_recent_failed' | 'reverified';
    reason?: string;
    rails?: string[];
  }>;
};

export type GrowRailOptions = {
  preset?: GrowPresetId;
  wallMs?: number;
  maxAttempts?: number;
  ingestBatchFresh?: number;
};

function playabilityGrowIngestBatch(): number {
  const raw = process.env.MANGO_PLAYABILITY_GROW_INGEST_BATCH;
  if (raw === undefined || raw === '') {
    return Math.min(playabilityFreshPerRail(), 40);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 5) {
    return Math.min(playabilityFreshPerRail(), 40);
  }
  return Math.min(parsed, 200);
}

export async function growRail(
  core: CatalogCore,
  railId: string,
  options: GrowRailOptions = {},
): Promise<GrowRailResult> {
  const rail = core.browsableRail(railId);
  if (rail.type === 'ai_catalog') {
    await applyAiCatalogTopUpHints(rail);
    await core.reloadAiCatalogRails();
  }

  const preset = resolveGrowPreset(options.preset);
  const wallMs = options.wallMs ?? preset.wall_ms;
  const maxAttempts = options.maxAttempts ?? preset.max_attempts;
  const ingestBatchFresh = options.ingestBatchFresh ?? playabilityGrowIngestBatch();
  const startedAt = Date.now();

  const before = await getRailPlayabilityStatus(rail.id);
  const growTarget = resolveGrowTarget(rail.playability, before.verified_pool);
  const growthPass: GrowthPassState = createGrowthPassState(
    [rail as BrowsableRail],
    new Map([[rail.id, growTarget]]),
  );

  let listSource = core.listSourceForRail(railId);
  let sourceOffsets = await loadSourceOffsetsForListSource(rail.id, listSource);
  let ingestOffset = sourceOffsets
    ? 0
    : ((await getRailIngestOffsetsBulk([rail.id])).get(rail.id) ?? 0);

  const allResults: GrowRailResult['results'] = [];
  let totalCandidatesSeen = 0;
  let totalLinked = 0;
  let totalVerified = 0;
  let totalFailed = 0;
  let totalSkippedExisting = 0;
  let totalSkippedRecentFailed = 0;
  let attempts = 0;
  let growLoops = 0;
  let maxSourcesTouched = 0;
  let lastIngest: IngestCandidatesStats | undefined;
  let catalogExhausted = false;
  let composeEscalated = false;
  let composeFallbackLevel: number | undefined;
  let sourceResetCycles = 0;
  const maxSourceResetCycles = playabilityGrowSourceResetCycles();

  const context = await createVerifyContext();

  const poolGrowthSoFar = async (): Promise<number> => {
    const status = await getRailPlayabilityStatus(rail.id);
    return Math.max(0, status.verified_pool - before.verified_pool);
  };

  async function reloadIngestState(): Promise<void> {
    listSource = core.listSourceForRail(railId);
    if (isSourceCursorListSource(listSource)) {
      listSource.resetAllSourceOffsets();
    }
    sourceOffsets = await loadSourceOffsetsForListSource(rail.id, listSource);
    ingestOffset = sourceOffsets
      ? 0
      : ((await getRailIngestOffsetsBulk([rail.id])).get(rail.id) ?? 0);
  }

  async function tryComposeOnExhaustion(): Promise<boolean> {
    if (composeEscalated || rail.type !== 'ai_catalog') {
      return false;
    }
    if (await poolGrowthSoFar() >= growTarget) {
      return false;
    }
    const escalation = await tryGrowComposeEscalation(core, rail as AiCatalogRail);
    if (!escalation.applied) {
      return false;
    }
    composeEscalated = true;
    composeFallbackLevel = escalation.fallback_level;
    catalogExhausted = false;
    await reloadIngestState();
    return true;
  }

  async function trySourceAdvanceOnExhaustion(): Promise<boolean> {
    if (sourceResetCycles >= maxSourceResetCycles) {
      return false;
    }
    if (await poolGrowthSoFar() >= growTarget) {
      return false;
    }
    sourceResetCycles += 1;
    catalogExhausted = false;
    const jump = playabilityIngestPageSize() * playabilityGrowSourceAdvancePages() * sourceResetCycles;
    if (isSourceCursorListSource(listSource)) {
      const offsets = new Map(listSource.readSourceOffsets());
      for (const key of listSource.listSourceKeys()) {
        offsets.set(key, (offsets.get(key) ?? 0) + jump);
      }
      listSource.writeSourceOffsets(offsets);
      await persistSourceOffsetsForListSource(rail.id, listSource);
      sourceOffsets = offsets;
    } else {
      ingestOffset += jump;
      await setRailIngestOffset(rail.id, ingestOffset);
    }
    return true;
  }

  try {
    while (Date.now() - startedAt < wallMs && attempts < maxAttempts) {
      if (await poolGrowthSoFar() >= growTarget) {
        break;
      }

      const remainingQuota = Math.max(0, growTarget - (await poolGrowthSoFar()));
      const freshTarget = growIngestFreshTarget(remainingQuota, ingestBatchFresh);

      const ingested = await ingestPaginatedCandidates(listSource, {
        startOffset: ingestOffset,
        sourceOffsets,
        freshTarget,
        pageSize: playabilityIngestPageSize(),
        maxScanned: playabilityMaxIngestScan(),
        lookupTitles: getTitlesPlayabilityBulk,
      });
      if (sourceOffsets) {
        await persistSourceOffsetsForListSource(rail.id, listSource);
      } else {
        await setRailIngestOffset(rail.id, ingested.next_offset);
        ingestOffset = ingested.next_offset;
      }
      lastIngest = ingested;
      growLoops += 1;
      maxSourcesTouched = Math.max(maxSourcesTouched, ingested.sources_touched ?? 0);
      totalCandidatesSeen += ingested.scanned;

      // Only skip link/verify when ingest found nothing left to process.
      if (
        ingested.fresh_queued === 0
        && ingested.catalog_exhausted
        && ingested.candidates.length === 0
      ) {
        catalogExhausted = true;
        if (await tryComposeOnExhaustion()) {
          continue;
        }
        if (await trySourceAdvanceOnExhaustion()) {
          continue;
        }
        break;
      }

      const candidates = ingested.candidates;
      if (candidates.length === 0) {
        catalogExhausted = ingested.catalog_exhausted;
        if (catalogExhausted && await tryComposeOnExhaustion()) {
          continue;
        }
        if (catalogExhausted && await trySourceAdvanceOnExhaustion()) {
          continue;
        }
        break;
      }
      const refsByKey = new Map<string, RailCandidateRef[]>();
      for (const [index, candidate] of candidates.entries()) {
        const key = candidateKey(candidate);
        refsByKey.set(key, [{ railId: rail.id, index, candidate }]);
      }

      const titleStatuses = await getTitlesPlayabilityBulk(candidates.map((candidate) => ({
        type: candidate.type,
        id: candidate.id,
      })));

      const afterStatus = await getRailPlayabilityStatus(rail.id);
      const { railVerifiedCounts, railPoolTargets } = railMapsFromRails(
        [rail as BrowsableRail],
        [afterStatus],
      );
      const railPoolKeys = new Map<string, Set<string>>([
        [rail.id, await getRailPoolTitleKeys(rail.id)],
      ]);

      const linked = await linkExistingVerifiedCandidates({
        refsByKey,
        titleStatuses,
        railVerifiedCounts,
        railPoolTargets,
        railPoolKeys,
        refreshMode: 'grow',
        growthPass,
        context,
      });

      const processed = await processVerifyQueue({
        core,
        queue: linked.verifyQueue,
        railVerifiedCounts,
        railPoolTargets,
        railPoolKeys,
        earlyExitMinDisplay: false,
        growthPass,
        context,
      });

      const iterationAttempts = processed.verified + processed.failed;
      attempts += iterationAttempts;

      totalLinked += linked.linked_existing;
      totalVerified += processed.verified;
      totalFailed += processed.failed;
      totalSkippedExisting += linked.skipped_existing;
      totalSkippedRecentFailed += linked.skipped_recent_failed;
      allResults.push(...linked.results, ...processed.results);

      if (ingested.catalog_exhausted) {
        catalogExhausted = true;
        if (await poolGrowthSoFar() < growTarget) {
          if (await tryComposeOnExhaustion()) {
            continue;
          }
          if (await trySourceAdvanceOnExhaustion()) {
            continue;
          }
          break;
        }
      }

      const madeLinkOrProbeProgress =
        linked.linked_existing > 0 || iterationAttempts > 0;
      if (!madeLinkOrProbeProgress && ingested.fresh_queued === 0) {
        catalogExhausted = ingested.catalog_exhausted;
        if (catalogExhausted && await tryComposeOnExhaustion()) {
          continue;
        }
        if (catalogExhausted && await trySourceAdvanceOnExhaustion()) {
          continue;
        }
        break;
      }
    }
  } finally {
    await finalizeVerifyContext(context);
  }

  await pruneNonPlayableFromRailPools();

  if (rail.type === 'ai_catalog') {
    await clearAppliedTopUpHints(rail.id);
    await core.reloadAiCatalogRails();
  }

  const after = await getRailPlayabilityStatus(rail.id);
  const probeVerified = growthPass.verifiedAddedThisPass.get(rail.id) ?? 0;
  const poolGrowth = Math.max(0, after.verified_pool - before.verified_pool);
  const targetMet = poolGrowth >= growTarget;
  const exhausted = !targetMet && catalogExhausted;

  return {
    rail_id: rail.id,
    label: rail.label,
    ok: after.verified_pool >= rail.playability.min_display && targetMet,
    grow_target: growTarget,
    probe_verified: probeVerified,
    pool_growth: poolGrowth,
    grow_target_met: targetMet,
    growth_quota: growTarget,
    verified_added: probeVerified,
    growth_quota_met: targetMet,
    pool_target: growTarget,
    candidate_limit: maxAttempts,
    attempts,
    min_display: rail.playability.min_display,
    before,
    after,
    candidates_seen: totalCandidatesSeen,
    linked_existing: totalLinked,
    verified: totalVerified,
    failed: totalFailed,
    skipped_existing: totalSkippedExisting,
    skipped_recent_failed: totalSkippedRecentFailed,
    exhausted,
    grow_loops: growLoops,
    compose_escalated: composeEscalated || undefined,
    compose_fallback_level: composeFallbackLevel,
    sources_touched: maxSourcesTouched > 0 ? maxSourcesTouched : undefined,
    ingest: lastIngest,
    results: allResults,
  };
}

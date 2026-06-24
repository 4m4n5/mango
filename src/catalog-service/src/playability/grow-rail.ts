import type { CatalogCore } from '../core.js';
import type { BrowsableRail } from '../rails.js';
import {
  getRailIngestOffsetsBulk,
  getRailPlayabilityStatus,
  getRailPoolTitleKeys,
  getTitlesPlayabilityBulk,
  getActiveRailCandidateRejectionKeys,
  pruneNonPlayableFromRailPools,
  recordRailCandidateRejections,
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
  flushVerifyContextBatch,
  linkExistingVerifiedCandidates,
  processVerifyQueue,
  railMapsFromRails,
  type PlayabilityVerifyAction,
  type RailCandidateRef,
} from './pipeline.js';
import {
  playabilityFreshPerRail,
  playabilityIngestPageSize,
  playabilityMaxIngestScan,
  growIngestFreshTarget,
  playabilityGrowSourceAdvancePages,
  playabilityGrowSourceResetCycles,
  playabilityGrowHeadAdvancePages,
  playabilityGrowHeadTombstoneRatio,
  playabilityGrowHeadAdvanceMaxCycles,
  growLinkMaxPerRail,
  playabilityRailRejectionTtlMsForReason,
  playabilityGrowSourceFailMinSamples,
  playabilityGrowSourceNoVerifyScanLimit,
  playabilityGrowSourceThemeRejectMinSamples,
} from './config.js';
import {
  createGrowthPassState,
  freshVerifiedCount,
  setGrowthPassFreshCount,
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
import { growDeepPageBypassReasons } from './grow-tombstones.js';
import { runGlobalVerifiedLinkPass } from './grow-global-link.js';
import { shouldHeadAdvanceOnTombstoneSkew } from './grow-head-advance.js';
import { applyHitrateWeightsToListSource } from './source-hitrate-weights.js';
import {
  recordSourceGrowOutcome,
  type SourceGrowStats,
} from './source-hitrate-weights.js';
import { isSuppressibleListSource } from './list-source.js';
import { recordGrowRunState } from './grow-run-state.js';
import {
  sourceCircuitDecision,
  sourceCircuitSampleLimitForGrowTarget,
} from './grow-source-circuit.js';
import {
  sourceAdvanceJump,
  sourceOffsetsForGrowOutcome,
} from './grow-cursor-policy.js';
import { createCandidateNormalizer } from './candidate-normalize.js';

export type GrowRailResult = {
  rail_id: string;
  label: string;
  ok: boolean;
  grow_target: number;
  /** Probe-verified titles this pass (grow quota). */
  fresh_verified: number;
  probe_verified: number;
  pool_growth: number;
  grow_target_met: boolean;
  /** Strict grow SLA count: newly probe-verified titles linked to this rail in this run. */
  new_to_rail_verified: number;
  /** @deprecated Use grow_target — kept for one release. */
  growth_quota?: number;
  /** @deprecated Use probe_verified — kept for one release. */
  verified_added?: number;
  /** @deprecated Use grow_target_met — kept for one release. */
  growth_quota_met?: boolean;
  pool_target: number;
  candidate_limit: number;
  attempts: number;
  max_attempts: number;
  min_display: number;
  before: PlayabilityRailStatus;
  after: PlayabilityRailStatus;
  candidates_seen: number;
  linked_existing: number;
  linked_global: number;
  verified: number;
  failed: number;
  skipped_existing: number;
  skipped_recent_failed: number;
  skipped_rejected: number;
  duplicate_candidates: number;
  wasted_candidate_ratio?: number;
  exhausted: boolean;
  grow_loops: number;
  compose_escalated?: boolean;
  compose_fallback_level?: number;
  sources_touched?: number;
  source_stats?: SourceGrowStats[];
  failure_category?: GrowFailureCategory;
  repair_suggestions?: string[];
  ingest?: IngestCandidatesStats;
  results: Array<{
    type: string;
    id: string;
    title?: string;
    action: PlayabilityVerifyAction;
    reason?: string;
    rails?: string[];
  }>;
};

export type GrowFailureCategory =
  | 'rate_limited'
  | 'source_exhausted'
  | 'theme_rejected'
  | 'low_stream_hit_rate'
  | 'same_theme_fallback_exhausted'
  | 'time_budget_exceeded';

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
  const growTarget = resolveGrowTarget(rail.playability, before.verified_pool, rail.id);
  if (growTarget <= 0) {
    return {
      rail_id: rail.id,
      label: rail.label,
      ok: before.verified_pool >= rail.playability.min_display,
      grow_target: 0,
      fresh_verified: 0,
      probe_verified: 0,
      new_to_rail_verified: 0,
      pool_growth: 0,
      grow_target_met: true,
      growth_quota: 0,
      verified_added: 0,
      growth_quota_met: true,
      pool_target: rail.playability.pool_target,
      candidate_limit: 0,
      attempts: 0,
      max_attempts: maxAttempts,
      min_display: rail.playability.min_display,
      before,
      after: before,
      candidates_seen: 0,
      linked_existing: 0,
      linked_global: 0,
      verified: 0,
      failed: 0,
      skipped_existing: 0,
      skipped_recent_failed: 0,
      skipped_rejected: 0,
      duplicate_candidates: 0,
      exhausted: false,
      grow_loops: 0,
      results: [],
    };
  }
  const growthPass: GrowthPassState = createGrowthPassState(
    [rail as BrowsableRail],
    new Map([[rail.id, growTarget]]),
  );

  let listSource = core.listSourceForRail(railId);
  const normalizeCandidate = createCandidateNormalizer(core);
  let weightsApplied = applyHitrateWeightsToListSource(listSource, rail.content_type, rail.id);
  let sourceOffsets = await loadSourceOffsetsForListSource(rail.id, listSource);
  let ingestOffset = sourceOffsets
    ? 0
    : ((await getRailIngestOffsetsBulk([rail.id])).get(rail.id) ?? 0);

  const allResults: GrowRailResult['results'] = [];
  let totalCandidatesSeen = 0;
  let totalLinked = 0;
  let totalLinkedGlobal = 0;
  let totalVerified = 0;
  let totalFailed = 0;
  let totalSkippedExisting = 0;
  let totalSkippedRecentFailed = 0;
  let totalSkippedRejected = 0;
  let totalDuplicateCandidates = 0;
  let attempts = 0;
  let growLoops = 0;
  let maxSourcesTouched = 0;
  let lastIngest: IngestCandidatesStats | undefined;
  const sourceStats = new Map<string, SourceGrowStats>();
  let catalogExhausted = false;
  let composeEscalated = false;
  let composeFallbackLevel: number | undefined;
  let sourceResetCycles = 0;
  let headAdvanceCycles = 0;
  let usedDeepSourceAdvance = false;
  let preDeepSourceOffsets: Map<string, number> | undefined;
  let preDeepIngestOffset: number | undefined;
  const suppressedSources = new Map<string, string>();
  const maxSourceResetCycles = playabilityGrowSourceResetCycles();
  const maxHeadAdvanceCycles = playabilityGrowHeadAdvanceMaxCycles();
  const allowExistingVerifiedLinks = growLinkMaxPerRail() > 0;

  const context = await createVerifyContext(core);

  const freshQuotaSoFar = (): number => freshVerifiedCount(growthPass, rail.id);
  const strictFreshFromStatus = (status: PlayabilityRailStatus): number => (
    Math.max(0, status.verified_pool - before.verified_pool - totalLinked)
  );
  const syncFreshQuotaWithPool = async (): Promise<number> => {
    const status = await getRailPlayabilityStatus(rail.id);
    const strictFresh = strictFreshFromStatus(status);
    setGrowthPassFreshCount(growthPass, rail.id, strictFresh);
    return strictFresh;
  };

  function statForSource(sourceKey: string, sourceLabel = sourceKey): SourceGrowStats {
    const existing = sourceStats.get(sourceKey);
    if (existing) {
      return existing;
    }
    const [addon, catalog] = sourceKey.includes(':')
      ? sourceKey.split(/:(.*)/s).filter(Boolean)
      : ['', ''];
    const created: SourceGrowStats = {
      source_key: sourceKey,
      source_label: sourceLabel,
      content_type: rail.content_type,
      scanned: 0,
      fresh_queued: 0,
      skipped_verified: 0,
      skipped_recent_failed: 0,
      linked_verified_seen: 0,
      requested: 0,
      returned: 0,
      catalog_errors: 0,
      rate_limited: 0,
      exhausted: false,
      verified: 0,
      failed: 0,
      theme_rejected: 0,
    };
    if (addon) {
      created.source_addon = addon;
    }
    if (catalog) {
      created.source_catalog = catalog;
    }
    sourceStats.set(sourceKey, created);
    return created;
  }

  function mergeIngestSourceStats(ingested: IngestCandidatesStats): void {
    for (const row of ingested.source_stats ?? []) {
      const stat = statForSource(row.source_key, row.source_label);
      stat.scanned += row.scanned;
      stat.fresh_queued += row.fresh_queued;
      stat.skipped_verified += row.skipped_verified;
      stat.skipped_recent_failed += row.skipped_recent_failed;
      stat.linked_verified_seen += row.linked_verified_seen;
      stat.requested += row.requested;
      stat.returned += row.returned;
      stat.catalog_errors += row.catalog_errors;
      stat.rate_limited += row.rate_limited;
      stat.exhausted = stat.exhausted || row.exhausted;
    }
  }

  function sourceKeyForCandidate(key: string, sourceByCandidateKey: Map<string, string>): string | undefined {
    return sourceByCandidateKey.get(key);
  }

  function recordVerifyResultsBySource(
    results: GrowRailResult['results'],
    sourceByCandidateKey: Map<string, string>,
  ): void {
    for (const result of results) {
      const sourceKey = sourceKeyForCandidate(`${result.type}:${result.id}`, sourceByCandidateKey);
      if (!sourceKey) {
        continue;
      }
      const stat = statForSource(sourceKey);
      if (result.action === 'verified') {
        stat.verified += 1;
      } else if (result.action === 'failed') {
        stat.failed += 1;
        if (result.reason === 'rate_limited' || result.reason === 'rate_limit') {
          stat.rate_limited += 1;
        }
      } else if (result.action === 'skipped_theme') {
        stat.theme_rejected += 1;
      }
    }
  }

  function applySourceSuppressions(): void {
    if (isSuppressibleListSource(listSource)) {
      listSource.setSuppressedSourceKeys(new Set(suppressedSources.keys()));
    }
  }

  function evaluateSourceCircuits(): void {
    const circuitOptions = {
      failMinSamples: sourceCircuitSampleLimitForGrowTarget(
        playabilityGrowSourceFailMinSamples(),
        growTarget,
        8,
      ),
      noVerifyScanLimit: sourceCircuitSampleLimitForGrowTarget(
        playabilityGrowSourceNoVerifyScanLimit(),
        growTarget,
        20,
        4,
      ),
      themeRejectMinSamples: sourceCircuitSampleLimitForGrowTarget(
        playabilityGrowSourceThemeRejectMinSamples(),
        growTarget,
        8,
        1.5,
      ),
    };
    for (const stat of sourceStats.values()) {
      if (suppressedSources.has(stat.source_key)) {
        continue;
      }
      const decision = sourceCircuitDecision(stat, circuitOptions);
      if (decision.suppress && decision.reason) {
        suppressedSources.set(stat.source_key, decision.reason);
      }
    }
    applySourceSuppressions();
  }

  async function recordRejectedResults(
    results: GrowRailResult['results'],
    sourceByCandidateKey?: Map<string, string>,
  ): Promise<void> {
    const now = Date.now();
    await recordRailCandidateRejections(results.flatMap((result) => {
      if (result.action !== 'failed' && result.action !== 'skipped_theme') {
        return [];
      }
      const reason = result.reason ?? result.action;
      const ttl = playabilityRailRejectionTtlMsForReason(reason);
      if (ttl <= 0) {
        return [];
      }
      const sourceKey = sourceByCandidateKey?.get(`${result.type}:${result.id}`);
      return (result.rails ?? [rail.id]).map((railId) => ({
        rail_id: railId,
        type: result.type,
        id: result.id,
        reason,
        source_key: sourceKey,
        run_id: process.env.MANGO_OPS_RUN_ID,
        expires_at: now + ttl,
      }));
    }), now);
  }

  function heartbeat(message: string, extra: Record<string, unknown> = {}): void {
    recordGrowRunState({
      phase: 'grow',
      message,
      rail_id: rail.id,
      rail_label: rail.label,
      grow_target: growTarget,
      fresh_verified: freshQuotaSoFar(),
      attempts,
      max_attempts: maxAttempts,
      candidates_seen: totalCandidatesSeen,
      skipped_rejected: totalSkippedRejected,
      skipped_recent_failed: totalSkippedRecentFailed,
      duplicate_candidates: totalDuplicateCandidates,
      suppressed_sources: [...suppressedSources.entries()].map(([source, reason]) => `${source}:${reason}`),
      elapsed_ms: Date.now() - startedAt,
      wall_ms: wallMs,
      ...extra,
    });
  }

  async function reloadIngestState(): Promise<void> {
    listSource = core.listSourceForRail(railId);
    weightsApplied = applyHitrateWeightsToListSource(listSource, rail.content_type, rail.id) || weightsApplied;
    applySourceSuppressions();
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
    if (freshQuotaSoFar() >= growTarget) {
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
    if (freshQuotaSoFar() >= growTarget) {
      return false;
    }
    sourceResetCycles += 1;
    usedDeepSourceAdvance = true;
    catalogExhausted = false;
    const jump = sourceAdvanceJump(playabilityIngestPageSize(), playabilityGrowSourceAdvancePages());
    if (isSourceCursorListSource(listSource)) {
      if (!preDeepSourceOffsets) {
        preDeepSourceOffsets = new Map(listSource.readSourceOffsets());
      }
      const offsets = new Map(listSource.readSourceOffsets());
      for (const key of listSource.listSourceKeys()) {
        offsets.set(key, (offsets.get(key) ?? 0) + jump);
      }
      listSource.writeSourceOffsets(offsets);
      sourceOffsets = offsets;
    } else {
      if (preDeepIngestOffset === undefined) {
        preDeepIngestOffset = ingestOffset;
      }
      ingestOffset += jump;
    }
    return true;
  }

  async function tryHeadAdvanceOnTombstoneSkew(ingested: IngestCandidatesStats): Promise<boolean> {
    if (sourceResetCycles > 0 || headAdvanceCycles >= maxHeadAdvanceCycles) {
      return false;
    }
    if (freshQuotaSoFar() >= growTarget) {
      return false;
    }
    const pageSize = playabilityIngestPageSize();
    if (!shouldHeadAdvanceOnTombstoneSkew(ingested, pageSize, playabilityGrowHeadTombstoneRatio())) {
      return false;
    }
    headAdvanceCycles += 1;
    catalogExhausted = false;
    const jump = pageSize * playabilityGrowHeadAdvancePages();
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
    applySourceSuppressions();
    heartbeat(`grow ${rail.id}: starting 0/${growTarget}`);
    const globalLink = await runGlobalVerifiedLinkPass(
      rail as BrowsableRail,
      growLinkMaxPerRail(),
      growthPass,
      context,
    );
    totalLinked += globalLink.linked;
    totalLinkedGlobal += globalLink.linked_global;
    allResults.push(...globalLink.results);
    await recordRejectedResults(globalLink.results);

    while (Date.now() - startedAt < wallMs && attempts < maxAttempts) {
      if (freshQuotaSoFar() >= growTarget) {
        break;
      }

      const remainingQuota = Math.max(0, growTarget - freshQuotaSoFar());
      const freshTarget = growIngestFreshTarget(remainingQuota, ingestBatchFresh);

      const deepPageBypass = sourceResetCycles > 0 ? growDeepPageBypassReasons() : undefined;

      heartbeat(`grow ${rail.id}: fetching candidates`, {
        stage: 'candidate_ingest',
        source_reset_cycles: sourceResetCycles,
        fresh_target: freshTarget,
      });
      const ingested = await ingestPaginatedCandidates(listSource, {
        startOffset: ingestOffset,
        sourceOffsets,
        collectActiveVerified: allowExistingVerifiedLinks,
        freshTarget,
        pageSize: playabilityIngestPageSize(),
        maxScanned: playabilityMaxIngestScan(),
        lookupTitles: getTitlesPlayabilityBulk,
        bypassRecentFailedReasons: deepPageBypass,
        normalizeCandidate,
      });
      if (sourceOffsets && isSourceCursorListSource(listSource)) {
        sourceOffsets = new Map(listSource.readSourceOffsets());
        if (!usedDeepSourceAdvance) {
          await persistSourceOffsetsForListSource(rail.id, listSource);
        }
      } else {
        await setRailIngestOffset(rail.id, ingested.next_offset);
        ingestOffset = ingested.next_offset;
      }
      lastIngest = ingested;
      mergeIngestSourceStats(ingested);
      evaluateSourceCircuits();
      growLoops += 1;
      maxSourcesTouched = Math.max(maxSourcesTouched, ingested.sources_touched ?? 0);
      totalCandidatesSeen += ingested.scanned;
      totalDuplicateCandidates += ingested.duplicate_candidates;

      if (await tryHeadAdvanceOnTombstoneSkew(ingested)) {
        continue;
      }

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

      const rejectedKeys = await getActiveRailCandidateRejectionKeys(rail.id, ingested.candidates);
      const candidates = ingested.candidates.filter((candidate) => {
        const rejected = rejectedKeys.has(candidateKey(candidate));
        if (rejected) {
          totalSkippedRejected += 1;
        }
        return !rejected;
      });
      const sourceByCandidateKey = new Map<string, string>();
      for (const candidate of ingested.candidates) {
        if (candidate.source_key || candidate.source) {
          sourceByCandidateKey.set(candidateKey(candidate), candidate.source_key ?? candidate.source ?? 'unknown');
        }
      }
      if (candidates.length === 0) {
        heartbeat(
          `grow ${rail.id}: ${freshQuotaSoFar()}/${growTarget} verified, skipped rejected page`,
          { catalog_exhausted: ingested.catalog_exhausted },
        );
        catalogExhausted = ingested.catalog_exhausted;
        if (catalogExhausted && await tryComposeOnExhaustion()) {
          continue;
        }
        if (catalogExhausted && await trySourceAdvanceOnExhaustion()) {
          continue;
        }
        continue;
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
        bypassRecentFailedReasons: deepPageBypass,
        allowExistingVerifiedLinks,
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
      heartbeat(`grow ${rail.id}: verifying candidates`, {
        stage: 'verify',
        loop: growLoops,
        verify_queue_size: linked.verifyQueue.length,
      });

      totalLinked += linked.linked_existing;
      totalVerified += processed.verified;
      totalFailed += processed.failed;
      totalSkippedExisting += linked.skipped_existing;
      totalSkippedRecentFailed += linked.skipped_recent_failed;
      allResults.push(...linked.results, ...processed.results);
      recordVerifyResultsBySource([...linked.results, ...processed.results], sourceByCandidateKey);
      evaluateSourceCircuits();

      const madeLinkOrProbeProgress =
        linked.linked_existing > 0 || iterationAttempts > 0;
      if (madeLinkOrProbeProgress) {
        await flushVerifyContextBatch(context);
      }
      await recordRejectedResults([...linked.results, ...processed.results], sourceByCandidateKey);
      if (madeLinkOrProbeProgress) {
        await syncFreshQuotaWithPool();
      }
      heartbeat(`grow ${rail.id}: ${freshQuotaSoFar()}/${growTarget} verified`, {
        loop: growLoops,
        ingested_fresh_queued: ingested.fresh_queued,
        verified: totalVerified,
        failed: totalFailed,
      });

      if (ingested.catalog_exhausted) {
        catalogExhausted = true;
        if (freshQuotaSoFar() < growTarget) {
          if (await tryComposeOnExhaustion()) {
            continue;
          }
          if (await trySourceAdvanceOnExhaustion()) {
            continue;
          }
          break;
        }
      }
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
  const poolGrowth = Math.max(0, after.verified_pool - before.verified_pool);
  const freshVerified = strictFreshFromStatus(after);
  setGrowthPassFreshCount(growthPass, rail.id, freshVerified);
  const targetMet = freshVerified >= growTarget;
  if (sourceOffsets && isSourceCursorListSource(listSource)) {
    const offsetsToPersist = sourceOffsetsForGrowOutcome({
      targetMet,
      usedDeepSourceAdvance,
      preDeepSourceOffsets,
      finalSourceOffsets: listSource.readSourceOffsets(),
    });
    if (offsetsToPersist) {
      listSource.writeSourceOffsets(offsetsToPersist);
      await persistSourceOffsetsForListSource(rail.id, listSource);
      sourceOffsets = offsetsToPersist;
    }
  } else if (usedDeepSourceAdvance && !targetMet && preDeepIngestOffset !== undefined) {
    ingestOffset = preDeepIngestOffset;
    await setRailIngestOffset(rail.id, ingestOffset);
  }
  const exhausted = !targetMet && catalogExhausted;
  const sourceStatsRows = [...sourceStats.values()];
  const failureCategory = targetMet
    ? undefined
    : classifyGrowFailure({
      sourceStats: sourceStatsRows,
      exhausted,
      attempts,
      maxAttempts,
      elapsedMs: Date.now() - startedAt,
      wallMs,
      verified: totalVerified,
      failed: totalFailed,
    });
  const repairSuggestions = targetMet
    ? undefined
    : repairSuggestionsForFailure(failureCategory, rail.id, sourceStatsRows);

  recordSourceGrowOutcome(
    rail.id,
    rail.content_type,
    sourceStatsRows,
    { growTargetMet: targetMet, weighted: weightsApplied, elapsedMs: Date.now() - startedAt },
  );
  recordGrowRunState({
    phase: 'grow',
    message: `grow ${rail.id}: ${freshVerified}/${growTarget} verified${targetMet ? '' : ' short'}`,
    rail_id: rail.id,
    rail_label: rail.label,
    grow_target: growTarget,
    fresh_verified: freshVerified,
    attempts,
    max_attempts: maxAttempts,
    candidates_seen: totalCandidatesSeen,
    skipped_rejected: totalSkippedRejected,
    suppressed_sources: [...suppressedSources.entries()].map(([source, reason]) => `${source}:${reason}`),
    elapsed_ms: Date.now() - startedAt,
    wall_ms: wallMs,
    ok: targetMet,
    failure_category: failureCategory,
  });

  return {
    rail_id: rail.id,
    label: rail.label,
    ok: after.verified_pool >= rail.playability.min_display && targetMet,
    grow_target: growTarget,
    fresh_verified: freshVerified,
    probe_verified: freshVerified,
    new_to_rail_verified: freshVerified,
    pool_growth: poolGrowth,
    grow_target_met: targetMet,
    growth_quota: growTarget,
    verified_added: freshVerified,
    growth_quota_met: targetMet,
    pool_target: growTarget,
    candidate_limit: maxAttempts,
    attempts,
    max_attempts: maxAttempts,
    min_display: rail.playability.min_display,
    before,
    after,
    candidates_seen: totalCandidatesSeen,
    linked_existing: totalLinked,
    linked_global: totalLinkedGlobal,
    verified: totalVerified,
    failed: totalFailed,
    skipped_existing: totalSkippedExisting,
    skipped_recent_failed: totalSkippedRecentFailed,
    skipped_rejected: totalSkippedRejected,
    duplicate_candidates: totalDuplicateCandidates,
    wasted_candidate_ratio: totalCandidatesSeen > 0
      ? (totalSkippedExisting + totalSkippedRecentFailed + totalSkippedRejected + totalDuplicateCandidates) / totalCandidatesSeen
      : undefined,
    exhausted,
    grow_loops: growLoops,
    compose_escalated: composeEscalated || undefined,
    compose_fallback_level: composeFallbackLevel,
    sources_touched: maxSourcesTouched > 0 ? maxSourcesTouched : undefined,
    source_stats: sourceStatsRows.length > 0 ? sourceStatsRows : undefined,
    failure_category: failureCategory,
    repair_suggestions: repairSuggestions,
    ingest: lastIngest,
    results: allResults,
  };
}

function classifyGrowFailure(options: {
  sourceStats: SourceGrowStats[];
  exhausted: boolean;
  attempts: number;
  maxAttempts: number;
  elapsedMs: number;
  wallMs: number;
  verified: number;
  failed: number;
}): GrowFailureCategory {
  const rateLimited = options.sourceStats.reduce((sum, stat) => sum + stat.rate_limited, 0);
  if (rateLimited > 0) {
    return 'rate_limited';
  }
  const themeRejected = options.sourceStats.reduce((sum, stat) => sum + stat.theme_rejected, 0);
  if (themeRejected > Math.max(2, options.verified + options.failed)) {
    return 'theme_rejected';
  }
  if (options.exhausted) {
    const anyReturned = options.sourceStats.some((stat) => stat.returned > 0);
    return anyReturned ? 'same_theme_fallback_exhausted' : 'source_exhausted';
  }
  if (options.failed > Math.max(5, options.verified * 2)) {
    return 'low_stream_hit_rate';
  }
  if (options.attempts >= options.maxAttempts || options.elapsedMs >= options.wallMs) {
    return 'time_budget_exceeded';
  }
  return 'same_theme_fallback_exhausted';
}

function repairSuggestionsForFailure(
  category: GrowFailureCategory | undefined,
  railId: string,
  sourceStats: SourceGrowStats[],
): string[] | undefined {
  if (!category) {
    return undefined;
  }
  const weakest = [...sourceStats]
    .sort((a, b) => (
      (b.rate_limited + b.catalog_errors + b.theme_rejected + b.failed)
      - (a.rate_limited + a.catalog_errors + a.theme_rejected + a.failed)
    ))
    .slice(0, 3)
    .map((stat) => stat.source_label || stat.source_key);
  const suffix = weakest.length ? ` (${weakest.join(', ')})` : '';
  const suggestions: Record<GrowFailureCategory, string> = {
    rate_limited: `Reduce or stagger grow pressure for rate-limited sources${suffix}; do not expose raw addon errors on TV.`,
    source_exhausted: `Add or replace same-theme sources for ${railId}${suffix}; existing sources returned no usable candidates.`,
    theme_rejected: `Review ${railId} source membership against rail-theme-profiles.yaml${suffix}; theme profiles remain manual-only.`,
    low_stream_hit_rate: `Probe source hit-rate and demote low-yield catalogs at runtime${suffix}; do not satisfy quota with unverified links.`,
    same_theme_fallback_exhausted: `Add broader same-theme fallback sources for ${railId}${suffix}; avoid cross-theme fills.`,
    time_budget_exceeded: `Increase grow window or reduce slow sources for ${railId}${suffix}; current run hit wall/attempt budget.`,
  };
  return [suggestions[category]];
}

import type { RefreshAllResult } from '../playability/refresh.js';
import type { TopUpRailResult } from '../playability/top-up.js';
import {
  appendOpsEvent,
  railDeltasFromTopUpResults,
  summarizeRailDeltas,
  writeOpsRunReport,
} from './log.js';
import type { OpsRailDelta } from './types.js';

function deltasFromRefresh(result: RefreshAllResult): OpsRailDelta[] {
  return result.rails.map((rail) => ({
    rail_id: rail.rail_id,
    label: rail.label,
    verified_before: rail.before.verified_pool,
    verified_after: rail.after.verified_pool,
    verified_added: rail.verified_added ?? (rail.after.verified_pool - rail.before.verified_pool),
    pool_before: rail.before.pool_depth,
    pool_after: rail.after.pool_depth,
    failed: rail.failed,
    candidates_seen: rail.candidates_seen,
    exhausted: rail.exhausted,
  }));
}

export function recordRefreshOps(
  result: RefreshAllResult,
  source: string,
  runId?: string,
): void {
  const deltas = deltasFromRefresh(result);
  const totalAdded = deltas.reduce((sum, delta) => sum + delta.verified_added, 0);
  const kind = result.mode === 'grow' ? 'playability_growth' : 'playability_refresh';
  appendOpsEvent(
    kind,
    `${result.mode} refresh: ${totalAdded >= 0 ? '+' : ''}${totalAdded} verified across ${deltas.filter((d) => d.verified_added !== 0).length} rails (${summarizeRailDeltas(deltas)})`,
    {
      mode: result.mode,
      bootstrap: result.bootstrap,
      duration_ms: result.duration_ms,
      verified: result.verified,
      failed: result.failed,
      ingest_fresh_queued: result.ingest_fresh_queued,
      ingest_scanned: result.ingest_scanned,
      rails: result.rails.map((rail) => ({
        rail_id: rail.rail_id,
        grow_target: rail.grow_target ?? rail.growth_quota,
        probe_verified: rail.probe_verified ?? rail.verified_added,
        pool_growth: rail.pool_growth ?? (
          rail.after.verified_pool - rail.before.verified_pool
        ),
        grow_target_met: rail.grow_target_met ?? rail.growth_quota_met,
        growth_quota: rail.growth_quota,
        verified_added: rail.verified_added,
        growth_quota_met: rail.growth_quota_met,
        grow_loops: rail.grow_loops,
        compose_escalated: rail.compose_escalated,
        compose_fallback_level: rail.compose_fallback_level,
        attempts: rail.attempts,
        verified_before: rail.before.verified_pool,
        verified_after: rail.after.verified_pool,
        failed: rail.failed,
        exhausted: rail.exhausted,
      })),
    },
    { run_id: runId, source },
  );
  if (runId) {
    writeOpsRunReport(runId, {
      kind,
      source,
      run_id: runId,
      finished_at: new Date().toISOString(),
      result,
      rails: deltas,
    });
  }
}

export function recordTopUpOps(result: TopUpRailResult, source: string, runId?: string): void {
  const deltas = railDeltasFromTopUpResults([result]);
  const delta = deltas[0];
  if (!delta) return;
  appendOpsEvent(
    'playability_topup',
    `${result.rail_id}: ${delta.verified_before}→${delta.verified_after} (+${delta.verified_added} verified)`,
    {
      rail_id: result.rail_id,
      label: result.label,
      verified: result.verified,
      failed: result.failed,
      candidates_seen: result.candidates_seen,
      exhausted: result.exhausted,
      before: result.before,
      after: result.after,
      results: result.results.slice(0, 20),
    },
    { run_id: runId, source },
  );
}

export function recordCompanionOps(
  kind: 'companion_consolidate' | 'companion_gardener' | 'companion_llm',
  summary: string,
  payload: Record<string, unknown>,
  runId?: string,
): void {
  appendOpsEvent(kind, summary, payload, { run_id: runId, source: 'companion-nightly' });
  if (runId) {
    writeOpsRunReport(runId, {
      kind,
      run_id: runId,
      finished_at: new Date().toISOString(),
      summary,
      ...payload,
    });
  }
}

export function recordAiCatalogOps(
  kind: 'ai_catalog_bootstrap' | 'ai_catalog_create' | 'ai_catalog_migrate' | 'ai_catalog_refresh',
  summary: string,
  payload: Record<string, unknown>,
  source = 'catalog-service',
): void {
  appendOpsEvent(kind, summary, payload, { source });
}

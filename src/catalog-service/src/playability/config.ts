function positiveInt(value: string | undefined, fallback: number, min = 1, max = 32): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function boundedFloat(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function positiveDurationMs(
  value: string | undefined,
  fallback: number,
  min = 0,
  max = 30 * 24 * 60 * 60 * 1000,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

export function isMaintenanceMode(): boolean {
  return process.env.MANGO_MAINTENANCE_MODE === '1';
}

export function playabilityBootstrapFill(): boolean {
  return process.env.MANGO_PLAYABILITY_BOOTSTRAP === '1';
}

export function playabilityEarlyExitMinDisplay(): boolean {
  if (process.env.MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY === '0') return false;
  if (process.env.MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY === '1') return true;
  return playabilityBootstrapFill();
}

export function playabilityResolveConcurrency(): number {
  if (isMaintenanceMode()) {
    return positiveInt(process.env.MANGO_PLAYABILITY_RESOLVE_CONCURRENCY, 8, 1, 16);
  }
  return positiveInt(process.env.MANGO_PLAYABILITY_RESOLVE_CONCURRENCY, 3, 1, 16);
}

export function playabilityProbeConcurrency(): number {
  if (isMaintenanceMode()) {
    return positiveInt(process.env.MANGO_PLAYABILITY_PROBE_CONCURRENCY, 3, 1, 4);
  }
  return positiveInt(process.env.MANGO_PLAYABILITY_PROBE_CONCURRENCY, 1, 1, 4);
}

export function playabilityProbeTimeoutMs(): number {
  return positiveInt(process.env.MANGO_PLAYABILITY_PROBE_MS, 6000, 2000, 30000);
}

/** Couch N3a probe budget — verified titles must pass within this window. */
export function playabilityCouchProbeMs(): number {
  return positiveInt(process.env.MANGO_AUTO_PLAY_PROBE_MS, 6000, 500, 15000);
}

export function playabilityBatchDbEnabled(): boolean {
  if (process.env.MANGO_PLAYABILITY_BATCH_DB === '0') return false;
  if (process.env.MANGO_PLAYABILITY_BATCH_DB === '1') return true;
  return isMaintenanceMode();
}

export function playabilityUseProbePool(): boolean {
  if (process.env.MANGO_PLAYABILITY_PROBE_POOL === '0') return false;
  if (process.env.MANGO_PLAYABILITY_PROBE_POOL === '1') return true;
  return isMaintenanceMode();
}

export function isPlayabilityGrowPass(): boolean {
  return process.env.MANGO_PLAYABILITY_GROW_PASS === '1';
}

export function playabilityFailedRetryMs(): number {
  return positiveDurationMs(process.env.MANGO_PLAYABILITY_FAILED_RETRY_MS, 24 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000);
}

export function playabilityFailedRetryMsForReason(reason?: string | null): number {
  if (playabilityBootstrapFill()) {
    // Bootstrap re-probes titles poisoned by prior bad runs (e.g. probe argv bug).
    return 0;
  }
  switch (reason) {
    case 'no_stream':
    case 'title_mismatch':
      if (isPlayabilityGrowPass()) {
        return positiveDurationMs(
          process.env.MANGO_GROW_NO_STREAM_RETRY_MS,
          1 * 60 * 60 * 1000,
          0,
          7 * 24 * 60 * 60 * 1000,
        );
      }
      return positiveDurationMs(
        process.env.MANGO_PLAYABILITY_NO_STREAM_RETRY_MS,
        7 * 24 * 60 * 60 * 1000,
        0,
        30 * 24 * 60 * 60 * 1000,
      );
    case 'copyright':
    case 'status_clip':
      return positiveDurationMs(
        process.env.MANGO_PLAYABILITY_PERMANENT_FAIL_RETRY_MS,
        14 * 24 * 60 * 60 * 1000,
        0,
        30 * 24 * 60 * 60 * 1000,
      );
    default:
      return playabilityFailedRetryMs();
  }
}

export function playabilityVerifyMinDurationSec(contentType?: string): number {
  // Indexer probes: reject debrid status clips (~30–90s) without requiring full runtime.
  if (contentType === 'series') {
    return positiveInt(process.env.MANGO_PLAYABILITY_MIN_DURATION_SEC_SERIES, 120, 30, 7200);
  }
  return positiveInt(process.env.MANGO_PLAYABILITY_MIN_DURATION_SEC, 120, 30, 7200);
}

export function playabilityVerifyMaxCandidates(): number {
  return positiveInt(process.env.MANGO_PLAYABILITY_MAX_CANDIDATES, 3, 1, 5);
}

export function playabilityVerifyTtlMs(): number {
  return positiveDurationMs(process.env.MANGO_PLAYABILITY_TTL_MS, 48 * 60 * 60 * 1000, 3_600_000, 14 * 24 * 60 * 60 * 1000);
}

/** Fresh (untested) titles to queue per rail on each full refresh/top-up pass. */
export function playabilityFreshPerRail(): number {
  return boundedInt(process.env.MANGO_PLAYABILITY_FRESH_PER_RAIL, 40, 5, 200);
}

/** Override catalog yaml pool_growth_per_refresh for this process (quick vs nightly passes). */
export function playabilityPoolGrowthOverride(yamlGrowth: number): number {
  const raw = process.env.MANGO_PLAYABILITY_POOL_GROWTH_PER_REFRESH;
  if (raw === undefined || raw === '') {
    return yamlGrowth;
  }
  return boundedInt(raw, yamlGrowth, 1, 50);
}

/** @deprecated Use MANGO_PLAYABILITY_FRESH_PER_RAIL — kept for one release. */
export function playabilityFreshTargetPerRefresh(): number {
  const perRail = process.env.MANGO_PLAYABILITY_FRESH_PER_RAIL;
  if (perRail) {
    return boundedInt(perRail, 40, 5, 200);
  }
  return boundedInt(process.env.MANGO_PLAYABILITY_FRESH_TARGET, 100, 10, 500);
}

export function playabilityIngestPageSize(): number {
  return boundedInt(process.env.MANGO_PLAYABILITY_INGEST_PAGE_SIZE, 50, 10, 200);
}

export function playabilityMaxIngestScan(): number {
  return boundedInt(process.env.MANGO_PLAYABILITY_MAX_INGEST_SCAN, 1200, 50, 5000);
}

/** Pages to advance each catalog source when a grow pass exhausts without hitting target. */
export function playabilityGrowSourceAdvancePages(): number {
  return boundedInt(process.env.MANGO_GROW_SOURCE_ADVANCE_PAGES, 25, 5, 200);
}

/** Pages to advance on first-loop tombstone skew (before deep-page source reset cycles). */
export function playabilityGrowHeadAdvancePages(): number {
  return boundedInt(process.env.MANGO_GROW_HEAD_ADVANCE_PAGES, 5, 1, 50);
}

/** Fraction of ingest page that must be skipped_recent_failed to trigger head advance. */
export function playabilityGrowHeadTombstoneRatio(): number {
  return boundedFloat(process.env.MANGO_GROW_HEAD_TOMBSTONE_RATIO, 0.5, 0.1, 0.95);
}

/** Max head-advance cycles per rail grow session (independent of source reset cycles). */
export function playabilityGrowHeadAdvanceMaxCycles(): number {
  return boundedInt(process.env.MANGO_GROW_HEAD_ADVANCE_MAX_CYCLES, 8, 1, 30);
}

/** Grow passes: advance catalog cursors when exhausted but pool still below grow target. */
export function playabilityGrowSourceResetCycles(): number {
  return boundedInt(process.env.MANGO_GROW_SOURCE_RESET_CYCLES, 10, 0, 30);
}

/** When 1 (default in maintenance), grow refresh ok requires +grow_per_pass verified per rail. */
export function playabilityGrowRequireTarget(): boolean {
  if (process.env.MANGO_GROW_REQUIRE_TARGET === '0') return false;
  if (process.env.MANGO_GROW_REQUIRE_TARGET === '1') return true;
  return process.env.MANGO_MAINTENANCE_MODE === '1';
}

/**
 * Fresh candidates to queue per grow loop — scale with remaining quota (probe hit rate ~25–40%).
 */
export function growIngestFreshTarget(remainingQuota: number, batchDefault: number): number {
  if (remainingQuota <= 0) {
    return batchDefault;
  }
  const scaled = Math.max(batchDefault, remainingQuota * 5);
  return Math.min(scaled, 200);
}

/** Max cross-rail links per grow session (0 = global link pass off). Links never count toward grow quota. */
export function growLinkMaxPerRail(): number {
  return boundedInt(process.env.MANGO_GROW_LINK_MAX, 0, 0, 20);
}

export function isPlayabilityGrowthMode(mode?: string): boolean {
  if (mode === 'grow') {
    return true;
  }
  if (mode === 'growth' || mode === 'full') {
    console.warn(`playability: growth mode "${mode}" is deprecated — use "grow"`);
    return true;
  }
  const refreshMode = process.env.MANGO_PLAYABILITY_REFRESH_MODE;
  if (refreshMode === 'grow' || refreshMode === 'nightly') {
    return true;
  }
  if (refreshMode === 'growth' || refreshMode === 'full') {
    return true;
  }
  return process.env.MANGO_PLAYABILITY_GROWTH_MODE === '1';
}

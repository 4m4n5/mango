function positiveInt(value: string | undefined, fallback: number, min = 1, max = 32): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
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
  return positiveInt(process.env.MANGO_PLAYABILITY_PROBE_MS, 12000, 2000, 30000);
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

export function playabilityFailedRetryMs(): number {
  return positiveDurationMs(process.env.MANGO_PLAYABILITY_FAILED_RETRY_MS, 24 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000);
}

export function playabilityFailedRetryMsForReason(reason?: string | null): number {
  if (playabilityBootstrapFill() && reason === 'no_stream') {
    return 0;
  }
  switch (reason) {
    case 'no_stream':
    case 'title_mismatch':
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
  if (contentType === 'series') {
    return positiveInt(process.env.MANGO_PLAYABILITY_MIN_DURATION_SEC_SERIES, 300, 60, 7200);
  }
  return positiveInt(process.env.MANGO_PLAYABILITY_MIN_DURATION_SEC, 600, 60, 7200);
}

export function playabilityVerifyMaxCandidates(): number {
  return positiveInt(process.env.MANGO_PLAYABILITY_MAX_CANDIDATES, 3, 1, 5);
}

export function playabilityVerifyTtlMs(): number {
  return positiveDurationMs(process.env.MANGO_PLAYABILITY_TTL_MS, 48 * 60 * 60 * 1000, 3_600_000, 14 * 24 * 60 * 60 * 1000);
}

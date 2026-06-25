import type { SourceGrowStats } from './source-hitrate-weights.js';
import {
  playabilityGrowSourceCatalogErrorLimit,
  playabilityGrowSourceCircuitBreakerEnabled,
  playabilityGrowSourceFailMinSamples,
  playabilityGrowSourceFailRatio,
  playabilityGrowSourceMinVerifyRate,
  playabilityGrowSourceNoVerifyScanLimit,
  playabilityGrowSourceThemeRejectMinSamples,
  playabilityGrowSourceThemeRejectRatio,
} from './config.js';

export type SourceCircuitDecision = {
  suppress: boolean;
  reason?:
    | 'rate_limited'
    | 'catalog_errors'
    | 'zero_verified_yield'
    | 'theme_rejected'
    | 'low_stream_hit_rate'
    | 'unresolved_external_id';
};

export type SourceCircuitDecisionOptions = {
  noVerifyScanLimit?: number;
  failMinSamples?: number;
  themeRejectMinSamples?: number;
};

export function sourceCircuitSampleLimitForGrowTarget(
  configured: number,
  growTarget: number,
  floor: number,
  targetMultiplier = 1,
): number {
  const targetLimit = Math.max(floor, Math.ceil(growTarget * targetMultiplier));
  return Math.min(configured, targetLimit);
}

export function sourceCircuitDecision(
  stat: SourceGrowStats,
  options: SourceCircuitDecisionOptions = {},
): SourceCircuitDecision {
  if (!playabilityGrowSourceCircuitBreakerEnabled()) {
    return { suppress: false };
  }
  const noVerifyScanLimit = options.noVerifyScanLimit ?? playabilityGrowSourceNoVerifyScanLimit();
  const failMinSamples = options.failMinSamples ?? playabilityGrowSourceFailMinSamples();
  const themeRejectMinSamples = options.themeRejectMinSamples ?? playabilityGrowSourceThemeRejectMinSamples();
  const minVerifyRate = playabilityGrowSourceMinVerifyRate();

  if (stat.rate_limited > 0) {
    return { suppress: true, reason: 'rate_limited' };
  }
  if (stat.catalog_errors >= playabilityGrowSourceCatalogErrorLimit()) {
    return { suppress: true, reason: 'catalog_errors' };
  }
  if (
    stat.verified <= 0
    && stat.linked_verified_seen <= 0
    && (stat.failed > 0 || stat.theme_rejected > 0 || stat.returned === 0 || stat.exhausted)
    && stat.scanned >= noVerifyScanLimit
  ) {
    return { suppress: true, reason: 'zero_verified_yield' };
  }

  const themeSamples = stat.theme_rejected + stat.verified + stat.failed;
  if (
    themeSamples >= themeRejectMinSamples
    && stat.theme_rejected / Math.max(1, themeSamples) >= playabilityGrowSourceThemeRejectRatio()
  ) {
    return { suppress: true, reason: 'theme_rejected' };
  }

  const streamSamples = stat.failed + stat.verified;
  if (
    streamSamples >= failMinSamples
    && stat.failed / Math.max(1, streamSamples) >= playabilityGrowSourceFailRatio()
    && (
      stat.verified <= 0
      || stat.verified / Math.max(1, streamSamples) <= minVerifyRate
    )
  ) {
    return { suppress: true, reason: 'low_stream_hit_rate' };
  }

  const unresolvedExternal = stat.unresolved_external_id ?? 0;
  const unresolvedSamples = unresolvedExternal + stat.verified + stat.failed + stat.theme_rejected;
  if (
    stat.verified <= 0
    && unresolvedExternal >= failMinSamples
    && unresolvedExternal / Math.max(1, unresolvedSamples) >= playabilityGrowSourceFailRatio()
  ) {
    return { suppress: true, reason: 'unresolved_external_id' };
  }

  return { suppress: false };
}

import type { SourceGrowStats } from './source-hitrate-weights.js';
import {
  playabilityGrowSourceCatalogErrorLimit,
  playabilityGrowSourceCircuitBreakerEnabled,
  playabilityGrowSourceFailMinSamples,
  playabilityGrowSourceFailRatio,
  playabilityGrowSourceNoVerifyScanLimit,
  playabilityGrowSourceThemeRejectMinSamples,
  playabilityGrowSourceThemeRejectRatio,
} from './config.js';

export type SourceCircuitDecision = {
  suppress: boolean;
  reason?: 'rate_limited' | 'catalog_errors' | 'zero_verified_yield' | 'theme_rejected' | 'low_stream_hit_rate';
};

export function sourceCircuitDecision(stat: SourceGrowStats): SourceCircuitDecision {
  if (!playabilityGrowSourceCircuitBreakerEnabled()) {
    return { suppress: false };
  }
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
    && stat.scanned >= playabilityGrowSourceNoVerifyScanLimit()
  ) {
    return { suppress: true, reason: 'zero_verified_yield' };
  }

  const themeSamples = stat.theme_rejected + stat.verified + stat.failed;
  if (
    stat.verified <= 0
    && themeSamples >= playabilityGrowSourceThemeRejectMinSamples()
    && stat.theme_rejected / Math.max(1, themeSamples) >= playabilityGrowSourceThemeRejectRatio()
  ) {
    return { suppress: true, reason: 'theme_rejected' };
  }

  const streamSamples = stat.failed + stat.verified;
  if (
    stat.verified <= 0
    && streamSamples >= playabilityGrowSourceFailMinSamples()
    && stat.failed / Math.max(1, streamSamples) >= playabilityGrowSourceFailRatio()
  ) {
    return { suppress: true, reason: 'low_stream_hit_rate' };
  }

  return { suppress: false };
}

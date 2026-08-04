export type ResolveMetricCounter =
  | 'flight_join_user'
  | 'flight_join_background'
  | 'background_defer_foreground'
  | 'foreground_bypass_background'
  | 'provider_fanout_requests'
  | 'provider_fanout_addons'
  | 'stream_resolve_retries'
  | 'stream_resolve_retry_recoveries'
  | 'stream_resolve_retry_exhaustions'
  | 'alias_probes'
  | 'rate_limit_classifications'
  | 'ownership_deferrals';

/**
 * Fixed, credential-free categories used for resolver health. Never use an
 * addon name, manifest URL, stream URL, or stream id as a metric key: health
 * is intentionally safe to expose to an operator.
 */
export const RESOLVER_PROVIDER_CATEGORIES = [
  'aiostreams',
  'torrentio',
  'mediafusion',
  'comet',
  'cinemeta',
  'aiometadata',
  'live',
  'other',
] as const;

export type ResolverProviderCategory = (typeof RESOLVER_PROVIDER_CATEGORIES)[number];
export type ResolverProviderOutcome = 'success' | 'empty' | 'error';

export const RESOLVER_INDEXER_CATEGORIES = [
  'torrentio',
  'mediafusion',
  'comet',
  'other',
] as const;
export type ResolverIndexerCategory = (typeof RESOLVER_INDEXER_CATEGORIES)[number];

export const RESOLVER_DEBRID_CATEGORIES = [
  'torbox',
  'realdebrid',
  'other',
] as const;
export type ResolverDebridCategory = (typeof RESOLVER_DEBRID_CATEGORIES)[number];

export type ResolverProviderStats = {
  attempts: number;
  successes: number;
  empty: number;
  errors: number;
  streams: number;
  total_ms: number;
};

export type ResolverContributionSnapshot = {
  observed_at_ms: number | null;
  indexers: Record<ResolverIndexerCategory, number>;
  debrid: Record<ResolverDebridCategory, number>;
};

export type ResolverContributionRequestClass = 'user' | 'background';

const counters: Record<ResolveMetricCounter, number> = {
  flight_join_user: 0,
  flight_join_background: 0,
  background_defer_foreground: 0,
  foreground_bypass_background: 0,
  provider_fanout_requests: 0,
  provider_fanout_addons: 0,
  stream_resolve_retries: 0,
  stream_resolve_retry_recoveries: 0,
  stream_resolve_retry_exhaustions: 0,
  alias_probes: 0,
  rate_limit_classifications: 0,
  ownership_deferrals: 0,
};

let providerFanoutTotalMs = 0;

function emptyProviderStats(): ResolverProviderStats {
  return {
    attempts: 0,
    successes: 0,
    empty: 0,
    errors: 0,
    streams: 0,
    total_ms: 0,
  };
}

function emptyContributions(): ResolverContributionSnapshot {
  return {
    observed_at_ms: null,
    indexers: Object.fromEntries(
      RESOLVER_INDEXER_CATEGORIES.map((category) => [category, 0]),
    ) as Record<ResolverIndexerCategory, number>,
    debrid: Object.fromEntries(
      RESOLVER_DEBRID_CATEGORIES.map((category) => [category, 0]),
    ) as Record<ResolverDebridCategory, number>,
  };
}

const providerStats: Record<ResolverProviderCategory, ResolverProviderStats> = Object.fromEntries(
  RESOLVER_PROVIDER_CATEGORIES.map((category) => [category, emptyProviderStats()]),
) as Record<ResolverProviderCategory, ResolverProviderStats>;

const lastContributionsByRequestClass: Record<
  ResolverContributionRequestClass,
  ResolverContributionSnapshot
> = {
  user: emptyContributions(),
  background: emptyContributions(),
};

export function resolverProviderCategory(addonName: string | undefined): ResolverProviderCategory {
  const normalized = addonName?.trim().toLowerCase() ?? '';
  if (normalized.includes('aiostream')) return 'aiostreams';
  if (normalized.includes('torrentio')) return 'torrentio';
  if (normalized.includes('mediafusion')) return 'mediafusion';
  if (normalized.includes('comet')) return 'comet';
  if (normalized.includes('cinemeta')) return 'cinemeta';
  if (normalized.includes('aiometadata')) return 'aiometadata';
  if (normalized.includes('live')) return 'live';
  return 'other';
}

export function resolverProviderCategoryCounts(
  addonNames: Iterable<string | undefined>,
): Record<ResolverProviderCategory, number> {
  const counts = Object.fromEntries(
    RESOLVER_PROVIDER_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ResolverProviderCategory, number>;
  for (const addonName of addonNames) {
    counts[resolverProviderCategory(addonName)] += 1;
  }
  return counts;
}

export function recordResolverProviderOutcome(
  category: ResolverProviderCategory,
  outcome: ResolverProviderOutcome,
  streamCount: number,
  elapsedMs: number,
): void {
  const stats = providerStats[category];
  stats.attempts += 1;
  stats.streams += Math.max(0, streamCount);
  stats.total_ms += Math.max(0, elapsedMs);
  if (outcome === 'success') stats.successes += 1;
  else if (outcome === 'empty') stats.empty += 1;
  else stats.errors += 1;
}

export function recordResolverContributionSnapshot(
  requestClass: ResolverContributionRequestClass,
  contributions: Iterable<{
    indexer: ResolverIndexerCategory;
    debrid: ResolverDebridCategory;
  }>,
  observedAtMs = Date.now(),
): void {
  const next = emptyContributions();
  for (const contribution of contributions) {
    next.indexers[contribution.indexer] += 1;
    next.debrid[contribution.debrid] += 1;
  }
  next.observed_at_ms = Math.max(0, observedAtMs);
  lastContributionsByRequestClass[requestClass] = next;
}

export function recordResolveMetric(counter: ResolveMetricCounter, amount = 1): void {
  counters[counter] += amount;
}

export function recordProviderFanout(addonCount: number, elapsedMs: number): void {
  counters.provider_fanout_requests += 1;
  counters.provider_fanout_addons += Math.max(0, addonCount);
  providerFanoutTotalMs += Math.max(0, elapsedMs);
}

export function resolveMetricsSnapshot(): Record<ResolveMetricCounter, number> & {
  provider_fanout_total_ms: number;
  providers: Record<ResolverProviderCategory, ResolverProviderStats>;
  last_contributions: Record<ResolverContributionRequestClass, ResolverContributionSnapshot>;
} {
  return {
    ...counters,
    provider_fanout_total_ms: providerFanoutTotalMs,
    providers: Object.fromEntries(
      RESOLVER_PROVIDER_CATEGORIES.map((category) => [category, { ...providerStats[category] }]),
    ) as Record<ResolverProviderCategory, ResolverProviderStats>,
    last_contributions: {
      user: {
        observed_at_ms: lastContributionsByRequestClass.user.observed_at_ms,
        indexers: { ...lastContributionsByRequestClass.user.indexers },
        debrid: { ...lastContributionsByRequestClass.user.debrid },
      },
      background: {
        observed_at_ms: lastContributionsByRequestClass.background.observed_at_ms,
        indexers: { ...lastContributionsByRequestClass.background.indexers },
        debrid: { ...lastContributionsByRequestClass.background.debrid },
      },
    },
  };
}

export function resetResolveMetricsForTests(): void {
  for (const key of Object.keys(counters) as ResolveMetricCounter[]) counters[key] = 0;
  providerFanoutTotalMs = 0;
  for (const category of RESOLVER_PROVIDER_CATEGORIES) {
    Object.assign(providerStats[category], emptyProviderStats());
  }
  lastContributionsByRequestClass.user = emptyContributions();
  lastContributionsByRequestClass.background = emptyContributions();
}

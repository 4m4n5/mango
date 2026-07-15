export type ResolveMetricCounter =
  | 'flight_join_user'
  | 'flight_join_background'
  | 'foreground_bypass_background'
  | 'provider_fanout_requests'
  | 'provider_fanout_addons'
  | 'alias_probes'
  | 'rate_limit_classifications'
  | 'ownership_deferrals';

const counters: Record<ResolveMetricCounter, number> = {
  flight_join_user: 0,
  flight_join_background: 0,
  foreground_bypass_background: 0,
  provider_fanout_requests: 0,
  provider_fanout_addons: 0,
  alias_probes: 0,
  rate_limit_classifications: 0,
  ownership_deferrals: 0,
};

let providerFanoutTotalMs = 0;

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
} {
  return { ...counters, provider_fanout_total_ms: providerFanoutTotalMs };
}

export function resetResolveMetricsForTests(): void {
  for (const key of Object.keys(counters) as ResolveMetricCounter[]) counters[key] = 0;
  providerFanoutTotalMs = 0;
}

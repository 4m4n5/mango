import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recordProviderFanout,
  recordResolveMetric,
  resetResolveMetricsForTests,
  resolveMetricsSnapshot,
} from './resolve-metrics.js';

test('S2: resolve metrics count joins, bypasses, fan-out, aliases, and rate limits deterministically', () => {
  resetResolveMetricsForTests();
  recordResolveMetric('flight_join_user');
  recordResolveMetric('flight_join_background', 2);
  recordResolveMetric('background_defer_foreground');
  recordResolveMetric('foreground_bypass_background');
  recordResolveMetric('alias_probes', 3);
  recordResolveMetric('rate_limit_classifications', 4);
  recordProviderFanout(5, 12);
  assert.deepEqual(resolveMetricsSnapshot(), {
    flight_join_user: 1,
    flight_join_background: 2,
    background_defer_foreground: 1,
    foreground_bypass_background: 1,
    provider_fanout_requests: 1,
    provider_fanout_addons: 5,
    alias_probes: 3,
    rate_limit_classifications: 4,
    ownership_deferrals: 0,
    provider_fanout_total_ms: 12,
  });
});

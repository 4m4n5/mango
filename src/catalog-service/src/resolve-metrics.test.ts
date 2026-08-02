import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recordProviderFanout,
  recordResolverContributionSnapshot,
  recordResolverProviderOutcome,
  recordResolveMetric,
  resetResolveMetricsForTests,
  resolverProviderCategory,
  resolverProviderCategoryCounts,
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
  const snapshot = resolveMetricsSnapshot();
  assert.deepEqual(
    {
      flight_join_user: snapshot.flight_join_user,
      flight_join_background: snapshot.flight_join_background,
      background_defer_foreground: snapshot.background_defer_foreground,
      foreground_bypass_background: snapshot.foreground_bypass_background,
      provider_fanout_requests: snapshot.provider_fanout_requests,
      provider_fanout_addons: snapshot.provider_fanout_addons,
      alias_probes: snapshot.alias_probes,
      rate_limit_classifications: snapshot.rate_limit_classifications,
      ownership_deferrals: snapshot.ownership_deferrals,
      provider_fanout_total_ms: snapshot.provider_fanout_total_ms,
    },
    {
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
    },
  );
  assert.equal(snapshot.providers.aiostreams.attempts, 0);
  assert.equal(snapshot.last_contributions.user.observed_at_ms, null);
  assert.equal(snapshot.last_contributions.background.observed_at_ms, null);
});

test('S2: resolver health uses fixed categories and separates couch evidence from background work', () => {
  resetResolveMetricsForTests();
  assert.equal(resolverProviderCategory('AIOStreams (private configuration)'), 'aiostreams');
  assert.equal(resolverProviderCategory('unrecognized provider'), 'other');
  assert.deepEqual(
    resolverProviderCategoryCounts(['AIOStreams', 'Torrentio', 'unknown']),
    {
      aiostreams: 1,
      torrentio: 1,
      mediafusion: 0,
      comet: 0,
      cinemeta: 0,
      aiometadata: 0,
      live: 0,
      other: 1,
    },
  );

  recordResolverProviderOutcome('aiostreams', 'success', 3, 42);
  recordResolverProviderOutcome('torrentio', 'empty', 0, 8);
  recordResolverProviderOutcome('comet', 'error', 0, 10);
  recordResolverContributionSnapshot('user', [
    { indexer: 'torrentio', debrid: 'torbox' },
    { indexer: 'comet', debrid: 'realdebrid' },
  ], 101);
  recordResolverContributionSnapshot('background', [
    { indexer: 'mediafusion', debrid: 'other' },
  ], 202);

  const snapshot = resolveMetricsSnapshot();
  assert.deepEqual(snapshot.providers.aiostreams, {
    attempts: 1,
    successes: 1,
    empty: 0,
    errors: 0,
    streams: 3,
    total_ms: 42,
  });
  assert.deepEqual(snapshot.providers.torrentio, {
    attempts: 1,
    successes: 0,
    empty: 1,
    errors: 0,
    streams: 0,
    total_ms: 8,
  });
  assert.deepEqual(snapshot.providers.comet, {
    attempts: 1,
    successes: 0,
    empty: 0,
    errors: 1,
    streams: 0,
    total_ms: 10,
  });
  assert.deepEqual(snapshot.last_contributions.user, {
    observed_at_ms: 101,
    indexers: { torrentio: 1, mediafusion: 0, comet: 1, other: 0 },
    debrid: { torbox: 1, realdebrid: 1, other: 0 },
  });
  assert.deepEqual(snapshot.last_contributions.background, {
    observed_at_ms: 202,
    indexers: { torrentio: 0, mediafusion: 1, comet: 0, other: 0 },
    debrid: { torbox: 0, realdebrid: 0, other: 1 },
  });
  assert.equal(JSON.stringify(snapshot).includes('private configuration'), false);
});

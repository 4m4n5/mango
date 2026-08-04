import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogCore,
  errorPlaceholderCouchMessage,
  hasStreamResolveRetryBudget,
  normalizeStream,
  streamErrorPlaceholderCategory,
  streamResolveRetryPolicy,
  streamResolveRetryReason,
  type ResolveNote,
  type Stream,
} from './core.js';
import { resetResolveMetricsForTests, resolveMetricsSnapshot } from './resolve-metrics.js';

type RawResolution = {
  streams: Stream[];
  notes: ResolveNote[];
  resolveMs: number;
  cached: boolean;
};

type ResolverInternals = {
  addons: Array<{
    name: string;
    manifestUrl: string;
    manifest: { resources: Array<{ name: string; types: string[] }> };
  }>;
  liveRailConfig: null;
  streamCache: Map<string, {
    streams: Stream[];
    notes: ResolveNote[];
    resolveMs: number;
    expiresAt: number;
  }>;
  streamNegativeCache: Map<string, {
    until: number;
    userUntil: number;
    reason: 'miss' | 'rate_limited';
  }>;
  streamInvalidationGeneration: Map<string, number>;
  streamInFlight: Map<string, {
    baseKey: string;
    behaviorKey: string;
    requestClass: 'user' | 'background';
    promise: Promise<RawResolution>;
  }>;
  fetchAddonStreams(
    addon: unknown,
    type: string,
    id: string,
    options: unknown,
  ): Promise<{ streams: Stream[] }>;
  supplementThinStreams(
    type: string,
    id: string,
    streams: Stream[],
    notes: ResolveNote[],
    options: unknown,
  ): Promise<{ streams: Stream[]; notes: ResolveNote[] }>;
  rawStreams(
    type: string,
    id: string,
    options: {
      requestClass: 'user' | 'background';
      deadlineAtMs?: number;
      zeroStreamRetryAttempts?: number;
      zeroStreamRetryDelayMs?: number;
    },
  ): Promise<RawResolution>;
};

function playable(url = 'https://example.test/episode.mkv'): Stream {
  return {
    url,
    source: 'AIOStreams',
    name: '[TB] Torrentio 1080p',
    title: '[TB] Torrentio 1080p',
  };
}

function errorPlaceholder(description: string): Stream {
  return {
    url: 'https://github.com/Viren070/AIOStreams',
    source: 'AIOStreams',
    name: '[❌] AIOStreams',
    title: '[❌] AIOStreams',
    description,
  };
}

function resolverWithSequence(
  sequence: Array<Stream[] | Error>,
): { core: ResolverInternals; calls: Array<{ type: string; id: string; options: unknown }> } {
  const core = Object.create(CatalogCore.prototype) as ResolverInternals;
  core.addons = [{
    name: 'AIOStreams',
    manifestUrl: 'http://127.0.0.1:3035/stremio/test/manifest.json',
    manifest: { resources: [{ name: 'stream', types: ['movie', 'series'] }] },
  }];
  core.liveRailConfig = null;
  core.streamCache = new Map();
  core.streamNegativeCache = new Map();
  core.streamInvalidationGeneration = new Map();
  core.streamInFlight = new Map();
  const calls: Array<{ type: string; id: string; options: unknown }> = [];
  core.fetchAddonStreams = async (_addon, type, id, options) => {
    calls.push({ type, id, options });
    const next = sequence.shift();
    if (next instanceof Error) throw next;
    return { streams: next ?? [] };
  };
  core.supplementThinStreams = async (_type, _id, streams, notes) => ({ streams, notes });
  return { core, calls };
}

test('retry classifier admits only clean empties and non-authoritative error rows', () => {
  assert.equal(streamResolveRetryReason([], []), 'clean_empty');
  assert.equal(
    streamResolveRetryReason([errorPlaceholder('upstream fetch failed')], []),
    'transient_placeholder',
  );
  assert.equal(
    streamResolveRetryReason([errorPlaceholder('HTTP 429 too many requests')], []),
    null,
  );
  assert.equal(
    streamResolveRetryReason([errorPlaceholder('no streams found')], []),
    null,
  );
  assert.equal(
    streamResolveRetryReason([errorPlaceholder('invalid API key: fetch failed')], []),
    null,
  );
  assert.equal(
    streamResolveRetryReason([], [{ kind: 'addon_error', message: 'AIOStreams: HTTP 502' }]),
    null,
  );
  assert.equal(streamResolveRetryReason([playable()], []), null);
});

test('stream error classification prefers transient transport evidence over trailing no-stream copy', () => {
  assert.equal(
    streamErrorPlaceholderCategory(errorPlaceholder('fetch failed: no streams returned')),
    'transient',
  );
  assert.equal(
    streamErrorPlaceholderCategory(errorPlaceholder('invalid API key: upstream unavailable')),
    'permanent',
  );
});

test('URL-less provider diagnostics become credential-free internal placeholders', () => {
  const normalized = normalizeStream({
    name: '[❌] AIOStreams',
    description: 'fetch failed for https://secret.example/token/abc123',
  }, 'AIOStreams');
  assert.ok(normalized);
  assert.equal(streamErrorPlaceholderCategory(normalized), 'transient');
  assert.equal(normalized.url, 'https://example.invalid/mango-stream-error/transient');
  assert.doesNotMatch(JSON.stringify(normalized), /secret\.example|abc123/);
});

test('provider error rows use transient couch copy without leaking diagnostics', () => {
  assert.equal(
    errorPlaceholderCouchMessage([errorPlaceholder('upstream fetch failed')]),
    'catalog temporarily unavailable',
  );
  assert.equal(
    errorPlaceholderCouchMessage([errorPlaceholder('HTTP 429 too many requests')]),
    'catalog is busy — try again in a moment',
  );
});

test('retry budget reserves the delay and a useful fetch window', () => {
  assert.equal(hasStreamResolveRetryBudget(undefined, 1200, 1000), true);
  assert.equal(hasStreamResolveRetryBudget(3000, 1200, 1000), true);
  assert.equal(hasStreamResolveRetryBudget(2600, 1200, 1000), false);
});

test('only automatic VOD Play receives the two delayed confirmation passes', () => {
  assert.deepEqual(streamResolveRetryPolicy('movie', 'auto_play'), { attempts: 2, delay_ms: 1200 });
  assert.deepEqual(streamResolveRetryPolicy('series', 'auto_play'), { attempts: 2, delay_ms: 1200 });
  assert.deepEqual(streamResolveRetryPolicy('tv', 'auto_play'), { attempts: 0, delay_ms: 0 });
  assert.deepEqual(streamResolveRetryPolicy('movie', 'stream_list'), { attempts: 0, delay_ms: 0 });
  assert.deepEqual(streamResolveRetryPolicy('series', 'picker_refresh'), { attempts: 0, delay_ms: 0 });
});

test('one B press absorbs the observed empty, empty, playable sequence for the exact episode', async () => {
  resetResolveMetricsForTests();
  const winner = playable();
  const { core, calls } = resolverWithSequence([[], [], [winner]]);
  const episodeId = 'tt-example:2:5';
  const options = {
    requestClass: 'user' as const,
    deadlineAtMs: Date.now() + 10_000,
    zeroStreamRetryAttempts: 2,
    zeroStreamRetryDelayMs: 0,
  };

  const [first, second] = await Promise.all([
    core.rawStreams('series', episodeId, options),
    core.rawStreams('series', episodeId, options),
  ]);

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => `${call.type}:${call.id}`), [
    `series:${episodeId}`,
    `series:${episodeId}`,
    `series:${episodeId}`,
  ]);
  assert.deepEqual(first.streams, [winner]);
  assert.deepEqual(second.streams, [winner]);
  assert.equal(core.streamCache.has(`series:${episodeId}`), true);
  assert.equal(core.streamNegativeCache.has(`series:${episodeId}`), false);
  const metrics = resolveMetricsSnapshot();
  assert.equal(metrics.provider_fanout_requests, 3);
  assert.equal(metrics.flight_join_user, 1);
  assert.equal(metrics.stream_resolve_retries, 2);
  assert.equal(metrics.stream_resolve_retry_recoveries, 1);
  assert.equal(metrics.stream_resolve_retry_exhaustions, 0);
});

test('AIOStreams error placeholder can recover without reaching the couch', async () => {
  resetResolveMetricsForTests();
  const { core, calls } = resolverWithSequence([
    [errorPlaceholder('upstream fetch failed')],
    [playable()],
  ]);
  const result = await core.rawStreams('series', 'tt-example:1:1', {
    requestClass: 'user',
    deadlineAtMs: Date.now() + 10_000,
    zeroStreamRetryAttempts: 1,
    zeroStreamRetryDelayMs: 0,
  });
  assert.equal(calls.length, 2);
  assert.equal(result.streams.length, 1);
  assert.match(result.notes.at(-1)?.message ?? '', /recovered after 2 attempts/);
});

for (const [label, message, reason] of [
  ['server error', 'AIOStreams: HTTP 502', 'miss'],
  ['rate limit', 'AIOStreams: HTTP 429 too many requests', 'rate_limited'],
] as const) {
  test(`${label} is classified once and never immediately retried`, async () => {
    resetResolveMetricsForTests();
    const { core, calls } = resolverWithSequence([new Error(message), [playable()]]);
    const key = 'series:tt-example:1:2';
    const result = await core.rawStreams('series', 'tt-example:1:2', {
      requestClass: 'user',
      deadlineAtMs: Date.now() + 10_000,
      zeroStreamRetryAttempts: 1,
      zeroStreamRetryDelayMs: 0,
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(result.streams, []);
    assert.equal(core.streamNegativeCache.get(key)?.reason, reason);
    assert.equal(resolveMetricsSnapshot().stream_resolve_retries, 0);
  });
}

test('rate-limit placeholder enters couch backoff instead of a bypassable miss', async () => {
  resetResolveMetricsForTests();
  const { core, calls } = resolverWithSequence([
    [errorPlaceholder('HTTP 429 too many requests')],
    [playable()],
  ]);
  const key = 'series:tt-example:1:6';
  const result = await core.rawStreams('series', 'tt-example:1:6', {
    requestClass: 'user',
    deadlineAtMs: Date.now() + 10_000,
    zeroStreamRetryAttempts: 2,
    zeroStreamRetryDelayMs: 0,
  });
  assert.equal(calls.length, 1);
  assert.equal(streamErrorPlaceholderCategory(result.streams), 'rate_limited');
  assert.equal(core.streamNegativeCache.get(key)?.reason, 'rate_limited');
  assert.equal(resolveMetricsSnapshot().stream_resolve_retries, 0);
});

test('invalidation during retry delay stops the stale flight before another provider fan-out', async () => {
  resetResolveMetricsForTests();
  const { core, calls } = resolverWithSequence([[], [playable()]]);
  const invalidate = CatalogCore.prototype.invalidateStreams as unknown as (
    this: ResolverInternals,
    type: string,
    id: string,
  ) => unknown;
  const originalFetch = core.fetchAddonStreams;
  core.fetchAddonStreams = async (...args) => {
    const result = await originalFetch(...args);
    if (calls.length === 1) {
      setTimeout(() => invalidate.call(core, 'series', 'tt-example:1:7'), 0);
    }
    return result;
  };
  const result = await core.rawStreams('series', 'tt-example:1:7', {
    requestClass: 'user',
    deadlineAtMs: Date.now() + 10_000,
    zeroStreamRetryAttempts: 2,
    zeroStreamRetryDelayMs: 20,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.streams, []);
  assert.match(result.notes.at(-1)?.message ?? '', /invalidated/);
  assert.equal(core.streamCache.size, 0);
  assert.equal(core.streamNegativeCache.size, 0);
});

test('insufficient absolute deadline skips the confirmation request', async () => {
  resetResolveMetricsForTests();
  const { core, calls } = resolverWithSequence([[], [playable()]]);
  const result = await core.rawStreams('series', 'tt-example:1:3', {
    requestClass: 'user',
    deadlineAtMs: Date.now() + 1_000,
    zeroStreamRetryAttempts: 1,
    zeroStreamRetryDelayMs: 1_200,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.streams, []);
  assert.equal(resolveMetricsSnapshot().stream_resolve_retries, 0);
});

test('two confirmed clean empties write one final miss and honest attempt evidence', async () => {
  resetResolveMetricsForTests();
  const { core, calls } = resolverWithSequence([[], []]);
  const key = 'series:tt-example:1:4';
  const result = await core.rawStreams('series', 'tt-example:1:4', {
    requestClass: 'user',
    deadlineAtMs: Date.now() + 10_000,
    zeroStreamRetryAttempts: 1,
    zeroStreamRetryDelayMs: 0,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(result.streams, []);
  assert.equal(core.streamNegativeCache.get(key)?.reason, 'miss');
  assert.match(result.notes.at(-1)?.message ?? '', /zero streams after 2 attempts/);
  const metrics = resolveMetricsSnapshot();
  assert.equal(metrics.stream_resolve_retries, 1);
  assert.equal(metrics.stream_resolve_retry_recoveries, 0);
  assert.equal(metrics.stream_resolve_retry_exhaustions, 1);
});

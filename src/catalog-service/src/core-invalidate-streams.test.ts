import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogCore } from './core.js';

type CoreCacheInternals = {
  streamCache: Map<string, unknown>;
  streamNegativeCache: Map<string, unknown>;
  streamInvalidationGeneration: Map<string, number>;
  streamInFlight: Map<string, { baseKey: string; behaviorKey: string; requestClass: 'user' | 'background'; promise: Promise<unknown> }>;
  rawStreams(
    type: string,
    id: string,
    options: { requestClass: 'user' | 'background'; deadlineAtMs?: number },
  ): Promise<unknown>;
  performRawStreamResolve: (
    type: string,
    id: string,
    key: string,
    options: { requestClass: 'user' | 'background' },
    generation: number,
  ) => Promise<unknown>;
};

test('S5: title invalidation clears positive, negative, and incompatible flight state narrowly', () => {
  const internals = Object.create(CatalogCore.prototype) as CoreCacheInternals;
  internals.streamCache = new Map([
    ['movie:tt-target', {}],
    ['movie:tt-other', {}],
  ]);
  internals.streamNegativeCache = new Map([
    ['movie:tt-target', {}],
    ['movie:tt-other', {}],
  ]);
  internals.streamInvalidationGeneration = new Map();
  internals.streamInFlight = new Map([
    ['target-user', {
      baseKey: 'movie:tt-target', behaviorKey: '{}', requestClass: 'user', promise: Promise.resolve({}),
    }],
    ['other-user', {
      baseKey: 'movie:tt-other', behaviorKey: '{}', requestClass: 'user', promise: Promise.resolve({}),
    }],
  ]);
  const core = internals as unknown as CatalogCore;
  assert.deepEqual(core.invalidateStreams('movie', 'tt-target'), {
    positive: 1,
    negative: 1,
    flights: 1,
  });
  assert.deepEqual([...internals.streamCache.keys()], ['movie:tt-other']);
  assert.deepEqual([...internals.streamNegativeCache.keys()], ['movie:tt-other']);
  assert.deepEqual([...internals.streamInFlight.keys()], ['other-user']);
});

test('S5: first user resolve after invalidation reaches the provider exactly once', async () => {
  const internals = Object.create(CatalogCore.prototype) as CoreCacheInternals;
  internals.streamCache = new Map([['movie:tt-target', {}]]);
  internals.streamNegativeCache = new Map([['movie:tt-target', {}]]);
  internals.streamInvalidationGeneration = new Map();
  internals.streamInFlight = new Map([['old-background', {
    baseKey: 'movie:tt-target',
    behaviorKey: '{}',
    requestClass: 'background',
    promise: Promise.resolve({}),
  }]]);
  let providerCalls = 0;
  internals.performRawStreamResolve = async () => {
    providerCalls += 1;
    await Promise.resolve();
    return { streams: [], notes: [], resolveMs: 1, cached: false };
  };
  const core = internals as unknown as CatalogCore;
  core.invalidateStreams('movie', 'tt-target');

  await Promise.all([
    internals.rawStreams('movie', 'tt-target', { requestClass: 'user', deadlineAtMs: 10_000 }),
    internals.rawStreams('movie', 'tt-target', { requestClass: 'user', deadlineAtMs: 20_000 }),
  ]);
  assert.equal(providerCalls, 1);
});

test('S5: completion of an invalidated flight cannot delete its replacement flight', async () => {
  const internals = Object.create(CatalogCore.prototype) as CoreCacheInternals;
  internals.streamCache = new Map();
  internals.streamNegativeCache = new Map();
  internals.streamInvalidationGeneration = new Map();
  internals.streamInFlight = new Map();
  const resolvers: Array<(value: unknown) => void> = [];
  let providerCalls = 0;
  internals.performRawStreamResolve = async () => {
    providerCalls += 1;
    return new Promise((resolvePromise) => resolvers.push(resolvePromise));
  };
  const core = internals as unknown as CatalogCore;

  const first = internals.rawStreams('movie', 'tt-target', { requestClass: 'user' });
  core.invalidateStreams('movie', 'tt-target');
  const replacement = internals.rawStreams('movie', 'tt-target', { requestClass: 'user' });
  assert.equal(providerCalls, 2);

  resolvers[0]?.({ streams: [], notes: [], resolveMs: 1, cached: false });
  await first;
  const joinedReplacement = internals.rawStreams('movie', 'tt-target', { requestClass: 'user' });
  assert.equal(providerCalls, 2);

  resolvers[1]?.({ streams: [], notes: [], resolveMs: 1, cached: false });
  await Promise.all([replacement, joinedReplacement]);
});

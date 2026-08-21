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
    options: {
      requestClass: 'user' | 'background';
      deadlineAtMs?: number;
      zeroStreamRetryAttempts?: number;
      existingOnly?: boolean;
    },
  ): Promise<unknown>;
  performRawStreamResolve: (
    type: string,
    id: string,
    key: string,
    options: { requestClass: 'user' | 'background' },
    generation: number,
  ) => Promise<unknown>;
};

test('stream-list timeout recovery joins the existing user flight without another fan-out', async () => {
  const internals = Object.create(CatalogCore.prototype) as CoreCacheInternals;
  internals.streamCache = new Map();
  internals.streamNegativeCache = new Map();
  internals.streamInvalidationGeneration = new Map();
  internals.streamInFlight = new Map();
  let providerCalls = 0;
  let finish: ((value: unknown) => void) | undefined;
  internals.performRawStreamResolve = async () => {
    providerCalls += 1;
    return new Promise((resolvePromise) => {
      finish = resolvePromise;
    });
  };

  const initial = internals.rawStreams('movie', 'tt1160419', { requestClass: 'user' });
  const recovered = internals.rawStreams('movie', 'tt1160419', {
    requestClass: 'user',
    existingOnly: true,
  });
  assert.equal(providerCalls, 1);

  finish?.({ streams: [], notes: [], resolveMs: 20_000, cached: false });
  assert.equal(await recovered, await initial);
  assert.equal(providerCalls, 1);
});

test('stream-list timeout recovery never starts provider work after the flight is gone', async () => {
  const internals = Object.create(CatalogCore.prototype) as CoreCacheInternals;
  internals.streamCache = new Map();
  internals.streamNegativeCache = new Map();
  internals.streamInvalidationGeneration = new Map();
  internals.streamInFlight = new Map();
  let providerCalls = 0;
  internals.performRawStreamResolve = async () => {
    providerCalls += 1;
    return { streams: [], notes: [], resolveMs: 1, cached: false };
  };

  const result = await internals.rawStreams('movie', 'tt3659388', {
    requestClass: 'user',
    existingOnly: true,
  }) as { streams: unknown[]; cached: boolean };
  assert.deepEqual(result.streams, []);
  assert.equal(result.cached, true);
  assert.equal(providerCalls, 0);
});

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

test('W3: different-behavior background resolve waits behind the same-title user flight', async () => {
  const internals = Object.create(CatalogCore.prototype) as CoreCacheInternals;
  internals.streamCache = new Map();
  internals.streamNegativeCache = new Map();
  internals.streamInvalidationGeneration = new Map();
  internals.streamInFlight = new Map();
  const resolvers: Array<(value: unknown) => void> = [];
  const observed: Array<{ requestClass: string; deadlineAtMs?: number; zeroStreamRetryAttempts?: number }> = [];
  internals.performRawStreamResolve = async (_type, _id, _key, options) => {
    observed.push(options);
    return new Promise((resolvePromise) => resolvers.push(resolvePromise));
  };

  const user = internals.rawStreams('movie', 'tt-target', {
    requestClass: 'user',
    deadlineAtMs: 20_000,
  });
  const background = internals.rawStreams('movie', 'tt-target', {
    requestClass: 'background',
    deadlineAtMs: 90_000,
    zeroStreamRetryAttempts: 1,
  });
  await Promise.resolve();
  assert.equal(observed.length, 1, 'background must not start provider fan-out beside the couch');
  assert.equal(observed[0]?.requestClass, 'user');

  resolvers[0]?.({ streams: [], notes: [], resolveMs: 1, cached: false });
  await user;
  await Promise.resolve();
  assert.equal(observed.length, 2, 'background may re-enter only after the couch flight settles');
  assert.deepEqual(observed[1], {
    requestClass: 'background',
    deadlineAtMs: 90_000,
    zeroStreamRetryAttempts: 1,
  });

  resolvers[1]?.({ streams: [], notes: [], resolveMs: 1, cached: false });
  await background;
});

test('W3: user resolve still bypasses an older background flight with its own deadline', async () => {
  const internals = Object.create(CatalogCore.prototype) as CoreCacheInternals;
  internals.streamCache = new Map();
  internals.streamNegativeCache = new Map();
  internals.streamInvalidationGeneration = new Map();
  internals.streamInFlight = new Map();
  const resolvers: Array<(value: unknown) => void> = [];
  const observed: Array<{ requestClass: string; deadlineAtMs?: number }> = [];
  internals.performRawStreamResolve = async (_type, _id, _key, options) => {
    observed.push(options);
    return new Promise((resolvePromise) => resolvers.push(resolvePromise));
  };

  const background = internals.rawStreams('movie', 'tt-target', {
    requestClass: 'background',
    deadlineAtMs: 5_000,
  });
  const user = internals.rawStreams('movie', 'tt-target', {
    requestClass: 'user',
    deadlineAtMs: 85_000,
  });
  assert.deepEqual(observed, [
    { requestClass: 'background', deadlineAtMs: 5_000 },
    { requestClass: 'user', deadlineAtMs: 85_000 },
  ]);

  resolvers[0]?.({ streams: [], notes: [], resolveMs: 1, cached: false });
  resolvers[1]?.({ streams: [], notes: [], resolveMs: 1, cached: false });
  await Promise.all([background, user]);
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

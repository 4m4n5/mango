import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  liveChannelHealthKey,
  liveChannelHealthRegistryPath,
  queryLiveChannelHealth,
  queryLiveChannelHealthRecord,
  readLiveChannelHealthRegistry,
  recordLiveChannelHealth,
  sanitizeLiveHealthReason,
  summarizeLiveChannelHealth,
} from './health.js';

async function withTempRegistry(
  run: (path: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-health-'));
  try {
    await run(join(dir, 'nested', 'health.json'), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('live health path supports an operator-owned environment override', () => {
  const previous = process.env.MANGO_LIVE_HEALTH_REGISTRY;
  process.env.MANGO_LIVE_HEALTH_REGISTRY = '/operator/cache/live-health.json';
  try {
    assert.equal(liveChannelHealthRegistryPath(), '/operator/cache/live-health.json');
  } finally {
    if (previous === undefined) {
      delete process.env.MANGO_LIVE_HEALTH_REGISTRY;
    } else {
      process.env.MANGO_LIVE_HEALTH_REGISTRY = previous;
    }
  }
});

test('stable health keys are opaque and distinguish source plus channel identity', () => {
  const first = liveChannelHealthKey('AREA69', 'channel-1');
  assert.equal(first, liveChannelHealthKey(' area69 ', 'channel-1'));
  assert.notEqual(first, liveChannelHealthKey('free', 'channel-1'));
  assert.notEqual(first, liveChannelHealthKey('area69', 'channel-2'));
  assert.match(first, /^v1:[a-f0-9]{64}$/);
  assert.equal(first.includes('area69'), false);
  assert.equal(first.includes('channel-1'), false);
});

test('missing and malformed registries safely read as empty', async () => withTempRegistry(async (path) => {
  assert.deepEqual(await readLiveChannelHealthRegistry(path), { version: 1, records: {} });
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '{not-json');
  assert.deepEqual(await readLiveChannelHealthRegistry(path), { version: 1, records: {} });
}));

test('records success and failure history while freshness is caller-controlled', async () => withTempRegistry(async (path) => {
  await recordLiveChannelHealth({
    source: 'area69',
    channelId: '123',
    status: 'verified',
    observedAt: 1_000,
  }, path);
  await recordLiveChannelHealth({
    source: 'area69',
    channelId: '123',
    status: 'failed',
    observedAt: 2_000,
    reason: 'upstream timeout',
  }, path);

  const registry = await readLiveChannelHealthRegistry(path);
  const fresh = queryLiveChannelHealthRecord(registry, 'area69', '123', 500, 2_400);
  assert.equal(fresh.status, 'failed');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.last_success_at, 1_000);
  assert.equal(fresh.last_failure_at, 2_000);
  assert.equal(fresh.reason, 'upstream timeout');

  const stale = await queryLiveChannelHealth('area69', '123', 500, { now: 2_501, path });
  assert.equal(stale.status, 'unknown');
  assert.equal(stale.stale, true);
  const absent = await queryLiveChannelHealth('area69', 'missing', 500, { now: 2_501, path });
  assert.equal(absent.status, 'unknown');
  assert.equal(absent.stale, false);
}));

test('an older delayed observation adds history without replacing newer status', async () => withTempRegistry(async (path) => {
  await recordLiveChannelHealth({
    source: 'free', channelId: 'fifa', status: 'verified', observedAt: 2_000,
  }, path);
  await recordLiveChannelHealth({
    source: 'free', channelId: 'fifa', status: 'failed', observedAt: 1_000, reason: 'old failure',
  }, path);
  const result = await queryLiveChannelHealth('free', 'fifa', 5_000, { now: 2_100, path });
  assert.equal(result.status, 'verified');
  assert.equal(result.updated_at, 2_000);
  assert.equal(result.last_failure_at, 1_000);
  assert.equal(result.reason, undefined);
}));

test('an explicit unknown observation remains unknown without being reported stale', async () => withTempRegistry(async (path) => {
  await recordLiveChannelHealth({
    source: 'area69', channelId: 'unprobed', status: 'unknown', observedAt: 4_000,
  }, path);
  const result = await queryLiveChannelHealth('area69', 'unprobed', 500, { now: 4_100, path });
  assert.equal(result.status, 'unknown');
  assert.equal(result.stale, false);
  assert.equal(result.updated_at, 4_000);
}));

test('sanitizes failure reasons and never persists identities, URLs, or credentials', async () => withTempRegistry(async (path) => {
  const reason = 'GET https://alice:secret@example.test/live/u/p/1.ts password=hunter2 Bearer abc123';
  assert.equal(
    sanitizeLiveHealthReason(reason),
    'GET [redacted-url] password=[redacted] Bearer [redacted]',
  );
  await recordLiveChannelHealth({
    source: 'https://alice:secret@example.test',
    channelId: 'user/password/channel-42',
    status: 'failed',
    observedAt: 3_000,
    reason,
  }, path);
  const raw = await readFile(path, 'utf8');
  for (const secret of ['alice', 'secret', 'channel-42', 'hunter2', 'abc123', 'example.test']) {
    assert.equal(raw.includes(secret), false, `registry leaked ${secret}`);
  }
  assert.match(raw, /\[redacted-url\]/);
  const entries = await readdir(join(path, '..'));
  assert.deepEqual(entries, ['health.json']);
}));

test('serializes concurrent in-process read-modify-write updates', async () => withTempRegistry(async (path) => {
  await Promise.all(Array.from({ length: 24 }, (_, index) => recordLiveChannelHealth({
    source: index % 2 === 0 ? 'area69' : 'free',
    channelId: `channel-${index}`,
    status: index % 3 === 0 ? 'failed' : 'verified',
    observedAt: 10_000 + index,
  }, path)));
  const registry = await readLiveChannelHealthRegistry(path);
  assert.equal(Object.keys(registry.records).length, 24);
  assert.deepEqual(summarizeLiveChannelHealth(registry, 100, 10_050), {
    total: 24,
    verified: 16,
    failed: 8,
    unknown: 0,
    stale: 0,
  });
}));

test('summary reports stale as an additive subset of unknown', () => {
  const verifiedKey = liveChannelHealthKey('area69', 'verified');
  const failedKey = liveChannelHealthKey('area69', 'failed');
  const unknownKey = liveChannelHealthKey('area69', 'unknown');
  const staleKey = liveChannelHealthKey('area69', 'stale');
  const summary = summarizeLiveChannelHealth({
    version: 1,
    records: {
      [verifiedKey]: { status: 'verified', updated_at: 900, last_success_at: 900 },
      [failedKey]: { status: 'failed', updated_at: 900, last_failure_at: 900 },
      [unknownKey]: { status: 'unknown', updated_at: 900 },
      [staleKey]: { status: 'verified', updated_at: 100, last_success_at: 100 },
    },
  }, 200, 1_000);
  assert.deepEqual(summary, {
    total: 4,
    verified: 1,
    failed: 1,
    unknown: 2,
    stale: 1,
  });
});

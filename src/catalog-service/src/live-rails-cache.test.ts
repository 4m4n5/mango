import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  LIVE_RAILS_POLICY_VERSION,
  liveRailsDiskCacheCompatible,
  liveRailsDiskCacheFresh,
  liveRailsDiskCacheNonEmpty,
  liveRailsDiskCacheSummary,
  liveRailsBackgroundRefreshDecision,
  liveRailsCachePath,
  liveRailsRefreshStatusPath,
  readLiveRailsRefreshStatusSync,
  readLiveRailsDiskCache,
  writeLiveRailsDiskCache,
  writeLiveRailsRefreshStatus,
} from './live-rails-cache.js';

test('live rails disk cache accepts stale non-empty fallback and reports diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-cache-'));
  const oldPath = process.env.MANGO_LIVE_RAILS_CACHE;
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live-cache.json');
  try {
    const now = Date.now();
    await writeFile(liveRailsCachePath(), JSON.stringify({
      policy_version: LIVE_RAILS_POLICY_VERSION,
      saved_at: now - 2 * 60 * 60 * 1000,
      expires_at: now - 60 * 1000,
      payload: {
        tab: 'live',
        rails: [
          { rail_id: 'live-cricket', items: [{ id: 'one' }] },
          { id: 'live-football', items: [{ id: 'two' }, { id: 'three' }] },
        ],
      },
    }), 'utf8');

    const entry = await readLiveRailsDiskCache();
    assert.equal(liveRailsDiskCacheFresh(entry), false);
    assert.equal(liveRailsDiskCacheNonEmpty(entry), true);

    const summary = liveRailsDiskCacheSummary(entry);
    assert.equal(summary.path, process.env.MANGO_LIVE_RAILS_CACHE);
    assert.equal(summary.present, true);
    assert.equal(summary.compatible, true);
    assert.equal(summary.non_empty, true);
    assert.equal(summary.fresh, false);
    assert.equal(summary.rail_counts['live-cricket'], 1);
    assert.equal(summary.rail_counts['live-football'], 2);
  } finally {
    if (oldPath === undefined) {
      delete process.env.MANGO_LIVE_RAILS_CACHE;
    } else {
      process.env.MANGO_LIVE_RAILS_CACHE = oldPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('live rails disk cache rejects legacy policy payloads as fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-cache-'));
  const oldPath = process.env.MANGO_LIVE_RAILS_CACHE;
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live-cache.json');
  try {
    await writeFile(liveRailsCachePath(), JSON.stringify({
      saved_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payload: {
        tab: 'live',
        rails: [{ rail_id: 'live-world-cup', items: [{ id: 'generic-fifa' }] }],
      },
    }), 'utf8');
    const entry = await readLiveRailsDiskCache();
    assert.equal(liveRailsDiskCacheCompatible(entry), false);
    assert.equal(liveRailsDiskCacheFresh(entry), false);
    assert.equal(liveRailsDiskCacheNonEmpty(entry), false);
    assert.equal(liveRailsDiskCacheSummary(entry).compatible, false);
  } finally {
    if (oldPath === undefined) {
      delete process.env.MANGO_LIVE_RAILS_CACHE;
    } else {
      process.env.MANGO_LIVE_RAILS_CACHE = oldPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('live rails disk cache rejects policy v6 partial-source generations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-cache-'));
  const oldPath = process.env.MANGO_LIVE_RAILS_CACHE;
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live-cache.json');
  try {
    await writeFile(liveRailsCachePath(), JSON.stringify({
      policy_version: 6,
      saved_at: Date.now(),
      expires_at: Date.now() + 60_000,
      payload: { tab: 'live', rails: [{ rail_id: 'live-world-cup', items: [{ id: 'old' }] }] },
    }), 'utf8');
    const entry = await readLiveRailsDiskCache();
    assert.equal(liveRailsDiskCacheCompatible(entry), false);
    assert.equal(liveRailsDiskCacheNonEmpty(entry), false);
  } finally {
    if (oldPath === undefined) delete process.env.MANGO_LIVE_RAILS_CACHE;
    else process.env.MANGO_LIVE_RAILS_CACHE = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('live rails disk cache never treats empty cache as fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-cache-'));
  const oldPath = process.env.MANGO_LIVE_RAILS_CACHE;
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live-cache.json');
  try {
    await writeLiveRailsDiskCache({ tab: 'live', rails: [] }, 30);
    const entry = await readLiveRailsDiskCache();
    assert.equal(liveRailsDiskCacheFresh(entry), false);
    assert.equal(liveRailsDiskCacheNonEmpty(entry), false);
    assert.deepEqual(liveRailsDiskCacheSummary(entry).rail_counts, {});
  } finally {
    if (oldPath === undefined) {
      delete process.env.MANGO_LIVE_RAILS_CACHE;
    } else {
      process.env.MANGO_LIVE_RAILS_CACHE = oldPath;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('background refresh is stale-only, playback-safe, and rate-limited', () => {
  const base = {
    configReady: true,
    cacheFresh: false,
    playbackActive: false,
    inFlight: false,
    lastAttemptAt: null,
    now: 1_000_000,
    minAttemptIntervalMs: 300_000,
  };
  assert.deepEqual(liveRailsBackgroundRefreshDecision(base), { refresh: true, reason: 'stale' });
  assert.equal(liveRailsBackgroundRefreshDecision({ ...base, cacheFresh: true }).reason, 'cache_fresh');
  assert.equal(liveRailsBackgroundRefreshDecision({ ...base, playbackActive: true }).reason, 'playback_active');
  assert.equal(liveRailsBackgroundRefreshDecision({ ...base, inFlight: true }).reason, 'in_flight');
  assert.equal(liveRailsBackgroundRefreshDecision({ ...base, lastAttemptAt: 900_000 }).reason, 'rate_limited');
  assert.equal(liveRailsBackgroundRefreshDecision({ ...base, configReady: false }).reason, 'config_unavailable');
});

test('live refresh attempt and error survive process-local state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-live-refresh-status-'));
  const oldCachePath = process.env.MANGO_LIVE_RAILS_CACHE;
  const oldStatusPath = process.env.MANGO_LIVE_RAILS_REFRESH_STATUS;
  process.env.MANGO_LIVE_RAILS_CACHE = join(dir, 'live-cache.json');
  process.env.MANGO_LIVE_RAILS_REFRESH_STATUS = join(dir, 'refresh-status.json');
  try {
    await writeLiveRailsRefreshStatus({
      last_attempt_at: 1234,
      last_success_at: 1000,
      last_error: 'provider unavailable',
    });
    assert.equal(liveRailsRefreshStatusPath(), process.env.MANGO_LIVE_RAILS_REFRESH_STATUS);
    assert.deepEqual(readLiveRailsRefreshStatusSync(), {
      last_attempt_at: 1234,
      last_success_at: 1000,
      last_error: 'provider unavailable',
    });
  } finally {
    if (oldCachePath === undefined) delete process.env.MANGO_LIVE_RAILS_CACHE;
    else process.env.MANGO_LIVE_RAILS_CACHE = oldCachePath;
    if (oldStatusPath === undefined) delete process.env.MANGO_LIVE_RAILS_REFRESH_STATUS;
    else process.env.MANGO_LIVE_RAILS_REFRESH_STATUS = oldStatusPath;
    await rm(dir, { recursive: true, force: true });
  }
});

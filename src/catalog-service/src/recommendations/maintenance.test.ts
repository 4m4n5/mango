import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acquireRecommendationMaintenanceLease,
  readFreshRecommendationMaintenanceLease,
  recommendationMemorySnapshot,
} from './maintenance.js';

test('recommendation maintenance lease is atomic, fresh-bounded, and releases cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-recommendation-lease-'));
  const path = join(dir, 'maintenance.lease');
  process.env.MANGO_RECOMMENDATION_MAINTENANCE_LEASE = path;
  try {
    const lease = acquireRecommendationMaintenanceLease({ owner: 'test:movie', ignoreCouch: true });
    assert.equal(readFreshRecommendationMaintenanceLease()?.owner, 'test:movie');
    assert.throws(
      () => acquireRecommendationMaintenanceLease({ owner: 'test:series', ignoreCouch: true }),
      /already active/,
    );
    const memory = lease.checkpoint('rank', '128/256');
    assert.ok(memory.rss > 0);
    assert.ok(memory.heap_used > 0);
    lease.release();
    assert.equal(readFreshRecommendationMaintenanceLease(), null);
  } finally {
    delete process.env.MANGO_RECOMMENDATION_MAINTENANCE_LEASE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale maintenance lease cannot suppress recovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-recommendation-lease-stale-'));
  const path = join(dir, 'maintenance.lease');
  process.env.MANGO_RECOMMENDATION_MAINTENANCE_LEASE = path;
  try {
    writeFileSync(path, JSON.stringify({ heartbeat_at: 1 }));
    assert.equal(readFreshRecommendationMaintenanceLease(Date.now()), null);
    const lease = acquireRecommendationMaintenanceLease({ owner: 'replacement', ignoreCouch: true });
    lease.release();
    const memory = recommendationMemorySnapshot();
    assert.equal(typeof memory.external, 'number');
    assert.equal(typeof memory.array_buffers, 'number');
  } finally {
    delete process.env.MANGO_RECOMMENDATION_MAINTENANCE_LEASE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fresh heartbeat from a dead process cannot suppress restart recovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-recommendation-lease-dead-pid-'));
  const path = join(dir, 'maintenance.lease');
  process.env.MANGO_RECOMMENDATION_MAINTENANCE_LEASE = path;
  try {
    writeFileSync(path, JSON.stringify({
      owner: 'vod:series',
      pid: 2_147_483_647,
      started_at: Date.now(),
      heartbeat_at: Date.now(),
      deadline_at: Date.now() + 60_000,
      phase: 'heartbeat',
      cursor: null,
    }));
    assert.equal(readFreshRecommendationMaintenanceLease(), null);
    const lease = acquireRecommendationMaintenanceLease({
      owner: 'vod:movies',
      ignoreCouch: true,
    });
    lease.release();
  } finally {
    delete process.env.MANGO_RECOMMENDATION_MAINTENANCE_LEASE;
    rmSync(dir, { recursive: true, force: true });
  }
});

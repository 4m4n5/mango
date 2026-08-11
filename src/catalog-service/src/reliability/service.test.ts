import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { computeStarvingRails } from './model.js';
import {
  playabilityFacts,
  railGrowthHistory,
  type PlayabilityStatusLike,
} from './service.js';

function statusRail(railId: string, verifiedPool: number) {
  return {
    rail_id: railId,
    pool_depth: verifiedPool,
    verified_pool: verifiedPool,
    pending: 0,
    stale: 0,
    failed: 0,
    last_verified_at: 1,
  };
}

function playabilityStatus(): PlayabilityStatusLike {
  return {
    ok: true,
    db_path: '/tmp/playability.db',
    schema_version: 17,
    rails: [
      statusRail('movies-active', 20),
      statusRail('series-active', 12),
      statusRail('historical-retired', 0),
    ],
    totals: {
      pool_depth: 32,
      verified_pool: 32,
      pending: 0,
      stale: 0,
      failed: 0,
    },
    last_indexer_run_at: 1,
  };
}

function refreshPayload(
  finishedAt: number,
  yieldValue: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    mode: 'grow',
    maintenance_rc: 0,
    all_rails_publishable: true,
    finished_at: finishedAt,
    rails: [{
      rail_id: 'series-active',
      grow_target: 20,
      new_to_rail_verified: yieldValue,
      grow_target_met: yieldValue >= 20,
    }],
    ...overrides,
  };
}

function writeRefresh(dir: string, name: string, payload: Record<string, unknown>): void {
  writeFileSync(join(dir, name), `${JSON.stringify(payload)}\n`, 'utf8');
}

test('library facts exclude historical status rows but preserve genuine active thin rails', () => {
  const healthy = playabilityFacts(playabilityStatus(), ['movies-active', 'series-active']);
  assert.equal(healthy.rail_count, 2);
  assert.equal(healthy.verified_total, 32);
  assert.deepEqual(healthy.thin_rails, []);

  const status = playabilityStatus();
  status.rails[1] = statusRail('series-active', 5);
  const thin = playabilityFacts(status, ['movies-active', 'series-active']);
  assert.equal(thin.verified_total, 25);
  assert.deepEqual(thin.thin_rails, [{ rail_id: 'series-active', verified_pool: 5 }]);
});

test('rail growth counts one completed publishable refresh per local calendar date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-growth-'));
  try {
    const dayOneEarly = new Date(2026, 0, 10, 2, 0, 0).getTime();
    const dayOneLate = new Date(2026, 0, 10, 18, 0, 0).getTime();
    const dayTwo = new Date(2026, 0, 11, 3, 0, 0).getTime();
    const dayThree = new Date(2026, 0, 12, 3, 0, 0).getTime();
    writeRefresh(dir, 'refresh-playability-20260110-020000.json', refreshPayload(dayOneEarly, 1));
    writeRefresh(dir, 'refresh-playability-20260110-180000.json', refreshPayload(dayOneLate, 5));
    writeRefresh(dir, 'refresh-playability-20260111-030000.json', refreshPayload(dayTwo, 2));
    writeRefresh(dir, 'refresh-playability-20260112-030000.json', refreshPayload(dayThree, 3));

    const history = railGrowthHistory(['series-active'], dir);
    assert.equal(history.length, 3);
    assert.equal(history[0]?.generated_at, dayOneLate);
    assert.equal(history[0]?.rails[0]?.new_to_rail_verified, 5);
    assert.equal(computeStarvingRails(history)[0]?.nights_missed, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rail growth ignores incomplete, discarded, and historical-rail artifacts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-growth-'));
  try {
    const base = new Date(2026, 1, 1, 3, 0, 0).getTime();
    writeRefresh(dir, 'refresh-playability-20260201-030000.json', refreshPayload(base, 2, { ok: false }));
    writeRefresh(dir, 'refresh-playability-20260202-030000.json', refreshPayload(base + 86_400_000, 2, { maintenance_rc: 1 }));
    writeRefresh(dir, 'refresh-playability-20260203-030000.json', refreshPayload(base + 2 * 86_400_000, 2, { all_rails_publishable: false }));
    writeRefresh(dir, 'refresh-playability-20260204-030000.json', refreshPayload(base + 3 * 86_400_000, 2, { finished_at: null }));
    writeRefresh(dir, 'refresh-playability-20260205-030000.json', refreshPayload(base + 4 * 86_400_000, 2, {
      rails: [{
        rail_id: 'historical-retired',
        grow_target: 20,
        new_to_rail_verified: 0,
        grow_target_met: false,
      }],
    }));
    writeRefresh(dir, 'refresh-playability-20260206-030000.json', refreshPayload(base + 5 * 86_400_000, 2));

    const history = railGrowthHistory(['series-active'], dir);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.rails[0]?.rail_id, 'series-active');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid artifact bursts cannot evict older valid calendar-night evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-reliability-growth-'));
  try {
    const first = new Date(2026, 2, 1, 3, 0, 0).getTime();
    for (let day = 0; day < 3; day += 1) {
      writeRefresh(
        dir,
        `refresh-playability-2026030${day + 1}-030000.json`,
        refreshPayload(first + day * 86_400_000, 1),
      );
    }
    for (let index = 0; index < 121; index += 1) {
      writeRefresh(
        dir,
        `refresh-playability-20260401-invalid-${String(index).padStart(3, '0')}.json`,
        refreshPayload(first + 31 * 86_400_000 + index, 0, { ok: false }),
      );
    }

    const history = railGrowthHistory(['series-active'], dir);
    assert.equal(history.length, 3);
    assert.equal(computeStarvingRails(history)[0]?.nights_missed, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

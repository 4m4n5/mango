import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getPlayabilityDb,
  getPlayabilityStatus,
  initPlayabilityDb,
  PLAYABILITY_WAL_AUTOCHECKPOINT_PAGES,
  prunePlayabilityMaintenance,
  resetPlayabilityDbForTests,
} from './db.js';

const ENV = { ...process.env };

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-db-singleton-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    process.env = { ...ENV };
    await rm(dir, { recursive: true, force: true });
  }
}

test('getPlayabilityDb returns the same handle across calls (singleton)', async () => {
  await withTempDb(async () => {
    await initPlayabilityDb();
    const a = getPlayabilityDb();
    const b = getPlayabilityDb();
    assert.strictEqual(a, b, 'expected identical singleton handle');
  });
});

test('singleton applies busy_timeout and WAL journal on first creation', async () => {
  await withTempDb(async () => {
    await initPlayabilityDb();
    const db = getPlayabilityDb();
    const busy = db.pragma('busy_timeout', { simple: true }) as number;
    const journal = db.pragma('journal_mode', { simple: true }) as string;
    const sync = db.pragma('synchronous', { simple: true }) as number;
    const walAutocheckpoint = db.pragma('wal_autocheckpoint', { simple: true }) as number;
    const temp = db.pragma('temp_store', { simple: true }) as number;
    assert.ok(busy > 0, `busy_timeout should be positive, got ${busy}`);
    assert.equal(String(journal).toLowerCase(), 'wal');
    assert.equal(sync, 1, 'synchronous should be NORMAL (1)');
    assert.equal(walAutocheckpoint, PLAYABILITY_WAL_AUTOCHECKPOINT_PAGES);
    assert.equal(temp, 2, 'temp_store should be MEMORY (2)');
  });
});

test('playability status reports the latest applied schema migration', async () => {
  await withTempDb(async () => {
    await initPlayabilityDb();
    const db = getPlayabilityDb();
    const latestMigration = db.prepare(`
SELECT COALESCE(MAX(version), 0) AS version
FROM playability_migrations;
`).get() as { version: number };
    const status = await getPlayabilityStatus([]);

    assert.equal(latestMigration.version, 19);
    assert.equal(status.schema_version, latestMigration.version);
  });
});

test('prunePlayabilityMaintenance removes verify_log rows older than 14 days', async () => {
  await withTempDb(async () => {
    await initPlayabilityDb();
    const db = getPlayabilityDb();
    const now = Date.now();
    const fifteenDaysAgo = now - 15 * 24 * 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const insert = db.prepare(`
INSERT INTO verify_log (started_at, rail_id, type, id_value, stage, ms, outcome)
VALUES (@started_at, NULL, 'movie', @id, 'verify', 0, 'verified');
`);
    insert.run({ started_at: fifteenDaysAgo, id: 'old-1' });
    insert.run({ started_at: fifteenDaysAgo - 1000, id: 'old-2' });
    insert.run({ started_at: oneDayAgo, id: 'new-1' });

    const beforeCount = db.prepare('SELECT COUNT(*) AS c FROM verify_log').get() as { c: number };
    assert.equal(beforeCount.c, 3);

    const removed = prunePlayabilityMaintenance(now);
    assert.ok(removed >= 2, `expected >=2 rows pruned, got ${removed}`);

    const remaining = db.prepare('SELECT id_value FROM verify_log ORDER BY id_value').all() as Array<{
      id_value: string;
    }>;
    assert.deepEqual(
      remaining.map((row) => row.id_value),
      ['new-1'],
      'newer verify_log rows must be preserved',
    );
  });
});

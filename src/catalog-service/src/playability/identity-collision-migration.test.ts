import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getPlayabilityDb,
  getPlayabilityStatus,
  initPlayabilityDb,
  resetPlayabilityDbForTests,
} from './db.js';

const ENV = { ...process.env };

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-identity-collision-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await initPlayabilityDb();
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    process.env = { ...ENV };
    await rm(dir, { recursive: true, force: true });
  }
}

test('migration 19 quarantines only verified bare IMDb dual-type identities and preserves state', async () => {
  await withTempDb(async () => {
    const db = getPlayabilityDb();
    const now = Date.now();
    const insertTitle = db.prepare(`
INSERT INTO titles(
  type, id, status, verified_at, first_verified_at, expires_at, fail_reason,
  best_source, proof_version, proof_run_id, proof_exact_main, updated_at
) VALUES (@type, @id, @status, @verified_at, @first_verified_at, @expires_at, @fail_reason,
          @best_source, @proof_version, @proof_run_id, @proof_exact_main, @updated_at);
`);
    const title = (type: string, id: string, status = 'verified') => ({
      type, id, status, verified_at: now - 1000, first_verified_at: now - 2000,
      expires_at: now + 86_400_000, fail_reason: null, best_source: 'fixture',
      proof_version: 2, proof_run_id: 'run-fixture', proof_exact_main: 1, updated_at: now - 1000,
    });
    db.transaction(() => {
      insertTitle.run(title('movie', 'tt1234567'));
      insertTitle.run(title('series', 'tt1234567'));
      insertTitle.run(title('movie', 'tt7654321'));
      insertTitle.run(title('movie', 'tt2222222', 'stale'));
      insertTitle.run(title('series', 'tt2222222'));
      insertTitle.run(title('movie', 'tt3333333:1:2'));
      insertTitle.run(title('series', 'tt3333333:1:2'));
      db.prepare(`
INSERT INTO rail_pool(rail_id, type, id, score, ingested_at, title)
VALUES ('movies-global-popular', 'movie', 'tt1234567', 1, ?, 'Movie identity'),
       ('series-global-popular', 'series', 'tt1234567', 1, ?, 'Series identity');
`).run(now, now);
      db.prepare(`
INSERT INTO verify_log(started_at, rail_id, type, id_value, stage, ms, outcome)
VALUES (?, NULL, 'movie', 'tt1234567', 'verify', 1, 'verified');
`).run(now - 1000);
      db.prepare('DELETE FROM playability_migrations WHERE version = 19').run();
    })();

    resetPlayabilityDbForTests();
    await initPlayabilityDb();
    const migrated = getPlayabilityDb();
    const collision = migrated.prepare(`
SELECT type, status, fail_reason, verified_at, expires_at, best_source,
       proof_version, proof_run_id, proof_exact_main
FROM titles WHERE id = 'tt1234567' ORDER BY type;
`).all() as Array<Record<string, unknown>>;
    assert.deepEqual(collision, [
      {
        type: 'movie', status: 'stale', fail_reason: 'identity_type_collision',
        verified_at: now - 1000, expires_at: now + 86_400_000, best_source: 'fixture',
        proof_version: 2, proof_run_id: 'run-fixture', proof_exact_main: 1,
      },
      {
        type: 'series', status: 'stale', fail_reason: 'identity_type_collision',
        verified_at: now - 1000, expires_at: now + 86_400_000, best_source: 'fixture',
        proof_version: 2, proof_run_id: 'run-fixture', proof_exact_main: 1,
      },
    ]);
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM rail_pool').get() as { count: number }).count, 2);
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM title_story_evidence').get() as { count: number }).count, 2);
    assert.equal((migrated.prepare('SELECT COUNT(*) AS count FROM verify_log').get() as { count: number }).count, 1);
    const retryRows = migrated.prepare(`
SELECT type, reason, priority, attempt_count, last_attempt_at, next_eligible_at
FROM playability_retry_queue WHERE id = 'tt1234567' ORDER BY type;
`).all() as Array<Record<string, unknown>>;
    assert.deepEqual(retryRows.map(({ next_eligible_at: _, ...row }) => row), [
      { type: 'movie', reason: 'identity_type_collision', priority: 70, attempt_count: 0, last_attempt_at: null },
      { type: 'series', reason: 'identity_type_collision', priority: 70, attempt_count: 0, last_attempt_at: null },
    ]);
    assert.ok(retryRows.every((row) => Number(row.next_eligible_at) <= Date.now()));
    assert.equal((migrated.prepare("SELECT status FROM titles WHERE type='movie' AND id='tt7654321'").get() as { status: string }).status, 'verified');
    assert.equal((migrated.prepare("SELECT status FROM titles WHERE type='series' AND id='tt2222222'").get() as { status: string }).status, 'verified');
    assert.equal((migrated.prepare("SELECT status FROM titles WHERE type='movie' AND id='tt3333333:1:2'").get() as { status: string }).status, 'verified');

    migrated.prepare('DELETE FROM playability_migrations WHERE version = 19').run();
    resetPlayabilityDbForTests();
    await initPlayabilityDb();
    assert.equal((getPlayabilityDb().prepare(`
SELECT COUNT(*) AS count FROM playability_retry_queue WHERE id = 'tt1234567'
`).get() as { count: number }).count, 2, 'rerunning migration is idempotent');
  });
});

test('playability status reports proof, expiry, type-conflict, and exact-episode aggregates', async () => {
  await withTempDb(async () => {
    const db = getPlayabilityDb();
    const now = Date.now();
    const insert = db.prepare(`
INSERT INTO titles(type, id, status, expires_at, fail_reason, proof_version, proof_exact_main, updated_at)
VALUES (@type, @id, @status, @expires_at, @fail_reason, @proof_version, @proof_exact_main, @updated_at);
`);
    db.transaction(() => {
      insert.run({ type: 'movie', id: 'tt1000001', status: 'verified', expires_at: now + 1000, fail_reason: null, proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'movie', id: 'tt1000002', status: 'verified', expires_at: now - 1, fail_reason: null, proof_version: 2, proof_exact_main: 1, updated_at: now });
      insert.run({ type: 'series', id: 'tt1000003:2:4', status: 'verified', expires_at: now + 1000, fail_reason: null, proof_version: 2, proof_exact_main: 1, updated_at: now });
      insert.run({ type: 'series', id: 'tt1000003:2:5', status: 'stale', expires_at: null, fail_reason: 'play_miss', proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'series', id: 'tt1000003:2:6', status: 'failed', expires_at: null, fail_reason: 'play_failure', proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'series', id: 'tt1000003:2:bad', status: 'failed', expires_at: null, fail_reason: 'play_failure', proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'series', id: 'tt100t003:2:7', status: 'failed', expires_at: null, fail_reason: 'play_failure', proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'movie', id: 'tt1000004', status: 'stale', expires_at: null, fail_reason: 'identity_type_collision', proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'series', id: 'tt1000004', status: 'stale', expires_at: null, fail_reason: 'identity_type_collision', proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'movie', id: 'tt1000005', status: 'verified', expires_at: now + 1000, fail_reason: null, proof_version: 1, proof_exact_main: 0, updated_at: now });
      insert.run({ type: 'series', id: 'tt1000005', status: 'verified', expires_at: now + 1000, fail_reason: null, proof_version: 1, proof_exact_main: 0, updated_at: now });
    })();
    const status = await getPlayabilityStatus([]);
    assert.deepEqual(status.verification, {
      legacy_verified: 3,
      exact_main_verified: 2,
      expired_verified: 1,
      identity_type_conflicts: { verified: 2, stale: 2 },
      exact_episodes: { verified: 1, stale: 1, failed: 1 },
    });
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getPlayabilityDb,
  recordVerifyResult,
  resetPlayabilityDbForTests,
} from './db.js';

async function withTempDb(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playability-proof-'));
  const previous = process.env.MANGO_PLAYABILITY_DB;
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  resetPlayabilityDbForTests();
  try {
    await fn();
  } finally {
    resetPlayabilityDbForTests();
    if (previous === undefined) delete process.env.MANGO_PLAYABILITY_DB;
    else process.env.MANGO_PLAYABILITY_DB = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test('legacy verified rows remain grandfathered while strict proof is receipt-bound', async () => {
  await withTempDb(async () => {
    await recordVerifyResult({
      type: 'movie',
      id: 'tt0000001',
      status: 'verified',
    });
    await recordVerifyResult({
      type: 'movie',
      id: 'tt0000002',
      status: 'verified',
      proof_version: 2,
      exact_main_win: true,
      run_id: 'run-1',
      request_id: 'request-1',
      request_title_id: 'tt0000002',
      request_title: 'Proof Movie',
      request_year: 2026,
      source_key: 'AIOStreams:main',
      attempt_kind: 'main',
    });

    const db = getPlayabilityDb();
    const titles = db.prepare(`
SELECT id, proof_version, proof_exact_main, proof_run_id
FROM titles
ORDER BY id
`).all() as Array<Record<string, unknown>>;
    assert.deepEqual(titles, [
      { id: 'tt0000001', proof_version: 1, proof_exact_main: 0, proof_run_id: null },
      { id: 'tt0000002', proof_version: 2, proof_exact_main: 1, proof_run_id: 'run-1' },
    ]);
    const receipt = db.prepare(`
SELECT run_id, request_id, request_title_id, request_title, request_year,
       source_key, attempt_kind, exact_main_win, proof_version
FROM verify_log
WHERE id_value = 'tt0000002'
`).get() as Record<string, unknown>;
    assert.deepEqual(receipt, {
      run_id: 'run-1',
      request_id: 'request-1',
      request_title_id: 'tt0000002',
      request_title: 'Proof Movie',
      request_year: '2026',
      source_key: 'AIOStreams:main',
      attempt_kind: 'main',
      exact_main_win: 1,
      proof_version: 2,
    });
  });
});

test('strict proof rejects fallback and mismatched requested identities', async () => {
  await withTempDb(async () => {
    await assert.rejects(recordVerifyResult({
      type: 'series',
      id: 'tt0000010:2:4',
      status: 'verified',
      proof_version: 2,
      exact_main_win: false,
      request_title_id: 'tt0000010:2:4',
      attempt_kind: 'fallback',
    }), /exact main-path win/);
    await assert.rejects(recordVerifyResult({
      type: 'series',
      id: 'tt0000010:2:4',
      status: 'verified',
      proof_version: 2,
      exact_main_win: true,
      request_title_id: 'tt0000010:2:5',
      attempt_kind: 'main',
    }), /request identity/);
    const count = getPlayabilityDb().prepare('SELECT COUNT(*) AS count FROM titles').get() as { count: number };
    assert.equal(count.count, 0);
  });
});

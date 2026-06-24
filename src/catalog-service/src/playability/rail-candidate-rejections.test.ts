import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  clearExpiredRailCandidateRejections,
  getActiveRailCandidateRejectionKeys,
  listActiveRailCandidateRejections,
  recordRailCandidateRejections,
} from './db.js';

const ENV = { ...process.env };

test.afterEach(async () => {
  const dbPath = process.env.MANGO_PLAYABILITY_DB;
  process.env = { ...ENV };
  if (dbPath?.includes('mango-rejections-')) {
    await rm(join(dbPath, '..'), { recursive: true, force: true });
  }
});

test('rail candidate rejections skip only active rail-specific titles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-rejections-'));
  process.env.MANGO_PLAYABILITY_DB = join(dir, 'playability.db');
  const now = 1_000;

  assert.equal(await recordRailCandidateRejections([
    {
      rail_id: 'movies-comedy',
      type: 'movie',
      id: 'tt-theme',
      reason: 'theme_probe_skip',
      source_key: 'A:c1',
      run_id: 'run-1',
      expires_at: now + 60_000,
    },
    {
      rail_id: 'movies-drama',
      type: 'movie',
      id: 'tt-other-rail',
      reason: 'theme_probe_skip',
      expires_at: now + 60_000,
    },
    {
      rail_id: 'movies-comedy',
      type: 'movie',
      id: 'tt-expired',
      reason: 'no_stream',
      expires_at: now - 1,
    },
  ], now), 2);

  const activeKeys = await getActiveRailCandidateRejectionKeys('movies-comedy', [
    { type: 'movie', id: 'tt-theme' },
    { type: 'movie', id: 'tt-other-rail' },
    { type: 'movie', id: 'tt-expired' },
  ], now);
  assert.deepEqual([...activeKeys], ['movie:tt-theme']);

  const rows = await listActiveRailCandidateRejections('movies-comedy', now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.reason, 'theme_probe_skip');
  assert.equal(rows[0]?.source_key, 'A:c1');
  assert.equal(await clearExpiredRailCandidateRejections(now), 0);
  assert.equal(await clearExpiredRailCandidateRejections(now + 60_001), 2);
});

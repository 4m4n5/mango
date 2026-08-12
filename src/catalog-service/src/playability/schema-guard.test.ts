import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initPlayabilityDb, resetPlayabilityDbForTests } from './db.js';

test('older code fails closed on a newer playability schema', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-playability-schema-'));
  const dbPath = join(dir, 'playability.db');
  const prior = process.env.MANGO_PLAYABILITY_DB;
  const db = new Database(dbPath);
  db.exec('CREATE TABLE playability_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO playability_migrations VALUES(999, 1);');
  db.close();
  process.env.MANGO_PLAYABILITY_DB = dbPath;
  resetPlayabilityDbForTests();
  try {
    await assert.rejects(initPlayabilityDb(), /newer than supported/);
  } finally {
    resetPlayabilityDbForTests();
    if (prior === undefined) delete process.env.MANGO_PLAYABILITY_DB;
    else process.env.MANGO_PLAYABILITY_DB = prior;
    await rm(dir, { recursive: true, force: true });
  }
});

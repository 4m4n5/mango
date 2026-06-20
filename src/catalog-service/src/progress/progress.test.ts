import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  continueSubtitle,
  isContinueEligible,
  progressTitleKey,
} from './keys.js';
import { initProgressDb, listContinueItems, resetProgressDbForTests, upsertWatchProgress } from './db.js';
import { resetWatchWatcherForTests } from './watcher.js';

test('progressTitleKey collapses series episodes to bare id', () => {
  assert.equal(progressTitleKey('series', 'tt35870921:1:3'), 'series:tt35870921');
  assert.equal(progressTitleKey('movie', 'tt0111161'), 'movie:tt0111161');
});

test('isContinueEligible enforces 5% to 90% window', () => {
  assert.equal(isContinueEligible(29, 600), false);
  assert.equal(isContinueEligible(60, 600), true);
  assert.equal(isContinueEligible(540, 600), false);
});

test('continueSubtitle formats episode progress', () => {
  assert.equal(continueSubtitle('tt35870921:1:3', 'series', 0.42), 'S1 E3 · 42%');
});

test('upsertWatchProgress stores and lists continue items', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-progress-'));
  process.env.MANGO_PROGRESS_DB_PATH = join(dir, 'progress.db');
  resetProgressDbForTests();
  resetWatchWatcherForTests();
  await initProgressDb();

  const saved = upsertWatchProgress({
    type: 'movie',
    id: 'tt0111161',
    play_id: 'tt0111161',
    title: 'Shawshank',
    poster: 'https://example.test/p.jpg',
    position_sec: 1200,
    duration_sec: 6000,
  });
  assert.ok(saved);
  assert.equal(saved?.progress_pct, 0.2);

  const movies = listContinueItems('movies');
  assert.equal(movies.length, 1);
  assert.equal(movies[0]?.title, 'Shawshank');

  upsertWatchProgress({
    type: 'movie',
    id: 'tt0111161',
    play_id: 'tt0111161',
    position_sec: 5700,
    duration_sec: 6000,
  });
  assert.equal(listContinueItems('movies').length, 0);

  rmSync(dir, { recursive: true, force: true });
  delete process.env.MANGO_PROGRESS_DB_PATH;
});

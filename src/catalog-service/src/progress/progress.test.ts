import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
  continueSubtitle,
  isContinueEligible,
  progressTitleKey,
} from './keys.js';
import {
  activateViewerProfile,
  createViewerProfile,
  initLibraryDb,
  libraryDatabase,
  listRecommendationAttribution,
  resetLibraryDbForTests,
} from '../library/db.js';
import { resetJournalForTests } from '../companion/journal.js';
import {
  getWatchProgressForTitle,
  initProgressDb,
  listContinueItems,
  resetProgressDbForTests,
  upsertWatchProgress,
} from './db.js';
import {
  recommendationRefreshStageForProgress,
  resetWatchWatcherForTests,
  startWatchSessionFromPlay,
} from './watcher.js';

test('progressTitleKey collapses series episodes to bare id', () => {
  assert.equal(progressTitleKey('series', 'tt35870921:1:3'), 'series:tt35870921');
  assert.equal(progressTitleKey('movie', 'tt0111161'), 'movie:tt0111161');
});

test('isContinueEligible enforces 1 min or 5% up to 90%', () => {
  assert.equal(isContinueEligible(45, 6000), false);
  assert.equal(isContinueEligible(60, 6000), true);
  assert.equal(isContinueEligible(29, 600), false);
  assert.equal(isContinueEligible(60, 600), true);
  assert.equal(isContinueEligible(540, 600), false);
});

test('continueSubtitle formats episode progress', () => {
  assert.equal(continueSubtitle('tt35870921:1:3', 'series', 0.42), 'S1 E3 · 42%');
});

test('recommendation refresh thresholds coalesce periodic playback progress', () => {
  assert.equal(recommendationRefreshStageForProgress(0), 1);
  assert.equal(recommendationRefreshStageForProgress(0.249), 1);
  assert.equal(recommendationRefreshStageForProgress(0.25), 2);
  assert.equal(recommendationRefreshStageForProgress(0.899), 2);
  assert.equal(recommendationRefreshStageForProgress(0.9), 3);
});

test('a validated episode play credits its immutable recommendation once across handoffs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-progress-attribution-'));
  process.env.MANGO_PROGRESS_DB_PATH = join(dir, 'progress.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  process.env.MANGO_COMPANION_DIR = join(dir, 'companion');
  resetProgressDbForTests();
  resetLibraryDbForTests();
  resetWatchWatcherForTests();
  resetJournalForTests();
  try {
    initLibraryDb();
    await initProgressDb();
    const viewer = createViewerProfile('Series Attribution');
    await startWatchSessionFromPlay({
      profile_id: viewer.profile_id,
      type: 'series',
      id: 'tt-series:2:7',
      recommendation: {
        profile_id: viewer.profile_id,
        domain: 'vod',
        rail_id: 'for-you-series',
        slate_revision: 4,
        item_type: 'series',
        item_id: 'tt-series',
      },
    });
    // A stream switch/retry reattaches the same logical play and immutable
    // served-card attribution. Neither the durable outcome nor its metric may
    // be counted again.
    await startWatchSessionFromPlay({
      profile_id: viewer.profile_id,
      type: 'series',
      id: 'tt-series:2:7',
      releaseFingerprint: 'alternate-stream',
      recommendation: {
        profile_id: viewer.profile_id,
        domain: 'vod',
        rail_id: 'for-you-series',
        slate_revision: 4,
        item_type: 'series',
        item_id: 'tt-series',
      },
    });
    // Idempotence is database-backed, not dependent on the in-memory active
    // session surviving a service restart.
    resetWatchWatcherForTests();
    await startWatchSessionFromPlay({
      profile_id: viewer.profile_id,
      type: 'series',
      id: 'tt-series:2:7',
      recommendation: {
        profile_id: viewer.profile_id,
        domain: 'vod',
        rail_id: 'for-you-series',
        slate_revision: 4,
        item_type: 'series',
        item_id: 'tt-series',
      },
    });
    assert.deepEqual(listRecommendationAttribution(viewer.profile_id).map((row) => ({
      item_type: row.item_type,
      item_id: row.item_id,
      play_started: row.play_started_at !== null,
    })), [{
      item_type: 'series',
      item_id: 'tt-series',
      play_started: true,
    }]);
    assert.deepEqual(libraryDatabase().prepare(`
SELECT metric_value FROM profile_recommendation_metrics
WHERE profile_id = ? AND metric_name = 'play_starts_for_you'
`).get(viewer.profile_id), { metric_value: 1 });
  } finally {
    resetWatchWatcherForTests();
    resetProgressDbForTests();
    resetLibraryDbForTests();
    resetJournalForTests();
    delete process.env.MANGO_PROGRESS_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    delete process.env.MANGO_COMPANION_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listContinueItems returns multiple titles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-progress-'));
  process.env.MANGO_PROGRESS_DB_PATH = join(dir, 'progress.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  resetProgressDbForTests();
  resetLibraryDbForTests();
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
    id: 'tt0468569',
    play_id: 'tt0468569',
    title: 'Dark Knight',
    position_sec: 120,
    duration_sec: 9000,
  });
  assert.equal(listContinueItems('movies').length, 2);

  upsertWatchProgress({
    type: 'movie',
    id: 'tt0111161',
    play_id: 'tt0111161',
    position_sec: 5700,
    duration_sec: 6000,
  });
  const afterComplete = listContinueItems('movies');
  assert.equal(afterComplete.length, 1);
  assert.equal(afterComplete[0]?.title, 'Dark Knight');

  rmSync(dir, { recursive: true, force: true });
  delete process.env.MANGO_PROGRESS_DB_PATH;
  delete process.env.MANGO_LIBRARY_DB_PATH;
  delete process.env.MANGO_USER_PINS_PATH;
  resetLibraryDbForTests();
});

test('Continue and exact resume are isolated per profile and a new profile starts clean', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-progress-profiles-'));
  process.env.MANGO_PROGRESS_DB_PATH = join(dir, 'progress.db');
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  resetProgressDbForTests();
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    await initProgressDb();
    const alice = createViewerProfile('Progress Alice');
    const bob = createViewerProfile('Progress Bob');
    activateViewerProfile(bob.profile_id);
    upsertWatchProgress({
      profile_id: alice.profile_id,
      type: 'movie',
      id: 'tt-shared',
      play_id: 'tt-shared',
      title: 'Shared title',
      position_sec: 600,
      duration_sec: 6_000,
    });
    upsertWatchProgress({
      profile_id: bob.profile_id,
      type: 'movie',
      id: 'tt-shared',
      play_id: 'tt-shared',
      title: 'Shared title',
      position_sec: 1_800,
      duration_sec: 6_000,
    });

    assert.equal(getWatchProgressForTitle('movie', 'tt-shared', {
      profile_id: alice.profile_id,
    })?.position_sec, 600);
    assert.equal(getWatchProgressForTitle('movie', 'tt-shared', {
      profile_id: bob.profile_id,
    })?.position_sec, 1_800);
    assert.equal(listContinueItems('movies', 10, {
      profile_id: alice.profile_id,
    })[0]?.progress.position_sec, 600);
    assert.equal(listContinueItems('movies', 10, {
      profile_id: bob.profile_id,
    })[0]?.progress.position_sec, 1_800);

    const newViewer = createViewerProfile('Clean Viewer');
    activateViewerProfile(newViewer.profile_id);
    assert.equal(getWatchProgressForTitle('movie', 'tt-shared'), null);
    assert.deepEqual(listContinueItems('movies'), []);
  } finally {
    resetProgressDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_PROGRESS_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy global progress migrates once to Household without leaking to personal profiles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mango-progress-legacy-'));
  const progressPath = join(dir, 'progress.db');
  process.env.MANGO_PROGRESS_DB_PATH = progressPath;
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  resetProgressDbForTests();
  resetLibraryDbForTests();
  const legacy = new Database(progressPath);
  legacy.exec(`
CREATE TABLE watch_progress (
  progress_key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  play_id TEXT NOT NULL,
  title TEXT,
  poster TEXT,
  position_sec REAL NOT NULL,
  duration_sec REAL NOT NULL,
  progress_pct REAL NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO watch_progress VALUES (
  'movie:tt-legacy', 'movie', 'tt-legacy', 'tt-legacy', 'Legacy movie', NULL,
  900, 6000, 0.15, 1234
);
`);
  legacy.close();
  try {
    initLibraryDb();
    await initProgressDb();
    assert.equal(getWatchProgressForTitle('movie', 'tt-legacy', {
      profile_id: 'household',
    })?.position_sec, 900);
    const alice = createViewerProfile('Legacy Alice');
    assert.equal(getWatchProgressForTitle('movie', 'tt-legacy', {
      profile_id: alice.profile_id,
    }), null);

    resetProgressDbForTests();
    await initProgressDb();
    const audit = new Database(progressPath, { readonly: true });
    try {
      const legacyRow = audit.prepare(`
SELECT position_sec FROM watch_progress WHERE progress_key = 'movie:tt-legacy'
`).get();
      assert.deepEqual(legacyRow, { position_sec: 900 });
      const migratedRows = audit.prepare(`
SELECT profile_id, position_sec FROM profile_watch_progress
WHERE progress_key = 'movie:tt-legacy'
`).all();
      assert.deepEqual(migratedRows, [{ profile_id: 'household', position_sec: 900 }]);
    } finally {
      audit.close();
    }
  } finally {
    resetProgressDbForTests();
    resetLibraryDbForTests();
    delete process.env.MANGO_PROGRESS_DB_PATH;
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

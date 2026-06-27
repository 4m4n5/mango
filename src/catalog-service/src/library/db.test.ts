import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
  getLibraryState,
  initLibraryDb,
  libraryItemKey,
  listSavedLibraryItems,
  listLibraryFeedback,
  listWatchHistory,
  recordLibraryWatch,
  resetLibraryDbForTests,
  saveLibraryItem,
  setLibraryFeedback,
  unsaveLibraryItem,
} from './db.js';

function withTempLibrary<T>(fn: (dir: string) => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-library-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  resetLibraryDbForTests();
  const cleanup = () => {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn(dir);
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('libraryItemKey is source-aware and collapses series episodes', () => {
  assert.equal(libraryItemKey('mango', 'series', 'tt123:1:2'), 'mango:series:tt123');
  assert.equal(libraryItemKey('youtube', 'youtube_video', 'AbC_123-XyZ'), 'youtube:youtube_video:AbC_123-XyZ');
  assert.notEqual(
    libraryItemKey('mango', 'movie', 'tt0111161'),
    libraryItemKey('youtube', 'movie', 'tt0111161'),
  );
});

test('initLibraryDb creates WAL schema and migration row', () => withTempLibrary((dir) => {
  initLibraryDb();
  const db = new Database(join(dir, 'library.db'));
  try {
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(String(mode).toLowerCase(), 'wal');
    const rows = db.prepare('SELECT version FROM library_migrations').all() as Array<{ version: number }>;
    assert.deepEqual(rows.map((row) => row.version), [1, 2]);
  } finally {
    db.close();
  }
}));

test('library feedback stores local source-aware negative signals', () => withTempLibrary(() => {
  const feedback = setLibraryFeedback({
    source: 'youtube',
    type: 'youtube_video',
    id: 'abc123',
    title: 'Nope',
    tab: 'youtube',
    feedback: 'not_interested',
    reason: 'user',
    created_at: 3000,
  });
  assert.equal(feedback.source, 'youtube');
  assert.equal(feedback.type, 'youtube_video');
  assert.equal(feedback.feedback, 'not_interested');
  const rows = listLibraryFeedback('not_interested', 'youtube');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, 'abc123');
}));

test('saved upsert and delete are idempotent', () => withTempLibrary(() => {
  const first = saveLibraryItem({
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    tab: 'movies',
  });
  const second = saveLibraryItem({
    type: 'movie',
    id: 'tt0111161',
    title: 'The Shawshank Redemption',
    tab: 'movies',
  });
  assert.equal(first.item_key, second.item_key);
  assert.equal(listSavedLibraryItems('movies').length, 1);
  assert.equal(getLibraryState({ type: 'movie', id: 'tt0111161' }).saved, true);
  assert.equal(unsaveLibraryItem({ type: 'movie', id: 'tt0111161' }), true);
  assert.equal(unsaveLibraryItem({ type: 'movie', id: 'tt0111161' }), false);
  assert.equal(getLibraryState({ type: 'movie', id: 'tt0111161' }).saved, false);
}));

test('unsave prunes unreferenced metadata but keeps watched metadata', () => withTempLibrary((dir) => {
  saveLibraryItem({ source: 'gate', type: 'movie', id: 'tt0000001', title: 'Gate' });
  assert.equal(unsaveLibraryItem({ source: 'gate', type: 'movie', id: 'tt0000001' }), true);

  let db = new Database(join(dir, 'library.db'));
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM library_items WHERE source = 'gate'")
      .get() as { count: number }).count,
    0,
  );
  db.close();

  saveLibraryItem({ type: 'movie', id: 'tt0111161', title: 'Watched' });
  recordLibraryWatch({
    type: 'movie',
    id: 'tt0111161',
    position_sec: 10,
    duration_sec: 100,
  });
  assert.equal(unsaveLibraryItem({ type: 'movie', id: 'tt0111161' }), true);

  db = new Database(join(dir, 'library.db'));
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM library_items WHERE id = 'tt0111161'")
      .get() as { count: number }).count,
    1,
  );
  db.close();
}));

test('legacy user-pins import runs once into Saved rows', () => withTempLibrary((dir) => {
  writeFileSync(
    join(dir, 'user-pins.json'),
    JSON.stringify({
      version: 1,
      pins: [
        {
          tab: 'movies',
          type: 'movie',
          id: 'tt0468569',
          title: 'The Dark Knight',
          poster: 'https://example.test/dark.jpg',
          pinned_at: 1234,
        },
      ],
    }),
    'utf8',
  );

  initLibraryDb();
  assert.equal(listSavedLibraryItems('movies').length, 1);
  resetLibraryDbForTests();
  initLibraryDb();
  const saved = listSavedLibraryItems('movies');
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.saved_at, 1234);
}));

test('watch history is indefinite and finished state uses 90 percent cutoff', () => withTempLibrary(() => {
  recordLibraryWatch({
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    position_sec: 30,
    duration_sec: 600,
    watched_at: 1000,
  });
  recordLibraryWatch({
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    position_sec: 540,
    duration_sec: 600,
    watched_at: 2000,
  });
  const history = listWatchHistory(10);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.event, 'finished');
  const state = getLibraryState({ type: 'movie', id: 'tt0111161' });
  assert.equal(state.finished, true);
  assert.equal(state.finished_at, 2000);
  assert.equal(state.latest_watch?.progress_pct, 0.9);
}));

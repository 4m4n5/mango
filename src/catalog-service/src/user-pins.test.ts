import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetLibraryDbForTests } from './library/db.js';
import { addUserPin, listUserPins, removeUserPin } from './user-pins.js';

function withTempLibrary<T>(fn: () => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-user-pins-'));
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
    const result = fn();
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

test('/pins compatibility wrappers use Saved backend', () => withTempLibrary(async () => {
  const pin = await addUserPin({
    tab: 'series',
    type: 'series',
    id: 'tt35870921:1:3',
    title: 'A Show',
    poster: 'https://example.test/show.jpg',
  });
  assert.equal(pin.id, 'tt35870921');
  assert.equal(pin.pinned_at > 0, true);

  const pins = await listUserPins('series');
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.title, 'A Show');

  assert.equal(await removeUserPin({ tab: 'series', type: 'series', id: 'tt35870921:1:8' }), true);
  assert.equal((await listUserPins('series')).length, 0);
}));


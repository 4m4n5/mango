import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  journalHasPlayCompleted,
  resetJournalForTests,
} from './journal.js';
import { readProfile, writeProfile } from './profile.js';
import { FRIEND_COMPLETED_WATCHES, defaultProfile } from './types.js';
import { recordPlaybackExit, recordPlayStarted, watchContentKey } from './watch-signals.js';

function withCompanionDir(run: () => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mango-companion-watch-'));
  const previous = process.env.MANGO_COMPANION_DIR;
  process.env.MANGO_COMPANION_DIR = dir;
  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      resetJournalForTests();
      if (previous === undefined) delete process.env.MANGO_COMPANION_DIR;
      else process.env.MANGO_COMPANION_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    });
}

test('recordPlayStarted and recordPlaybackExit journal watch signals', async () => {
  await withCompanionDir(async () => {
    await writeProfile(defaultProfile());
    const session = {
      type: 'movie',
      title_id: 'tt0111161',
      play_id: 'tt0111161',
      title: 'The Shawshank Redemption',
      tab: 'movies' as const,
      source: 'gate',
    };
    recordPlayStarted(session);
    await recordPlaybackExit(session, 5400, 6000);
    assert.equal(journalHasPlayCompleted(watchContentKey(session)), true);
    const profile = await readProfile();
    assert.equal(profile.familiarity.completed_watches, 1);
  });
});

test('completed watch increments familiarity only once per title', async () => {
  await withCompanionDir(async () => {
    await writeProfile(defaultProfile());
    const session = {
      type: 'movie',
      title_id: 'tt0468569',
      play_id: 'tt0468569',
      title: 'The Dark Knight',
      tab: 'movies' as const,
    };
    await recordPlaybackExit(session, 9000, 10000);
    await recordPlaybackExit(session, 9000, 10000);
    const profile = await readProfile();
    assert.equal(profile.familiarity.completed_watches, 1);
  });
});

test('abandoned watch does not bump completed_watches', async () => {
  await withCompanionDir(async () => {
    await writeProfile(defaultProfile());
    const session = {
      type: 'movie',
      title_id: 'tt1375666',
      play_id: 'tt1375666',
      title: 'Inception',
      tab: 'movies' as const,
    };
    await recordPlaybackExit(session, 600, 6000);
    const profile = await readProfile();
    assert.equal(profile.familiarity.completed_watches, 0);
    assert.equal(journalHasPlayCompleted(watchContentKey(session)), false);
  });
});

test('five unique completed watches reach friend stage with sessions', async () => {
  await withCompanionDir(async () => {
    let profile = defaultProfile();
    profile.familiarity.sessions = 20;
    await writeProfile(profile);
    for (let index = 0; index < FRIEND_COMPLETED_WATCHES; index += 1) {
      const session = {
        type: 'movie',
        title_id: `tt000000${index}`,
        play_id: `tt000000${index}`,
        title: `Movie ${index}`,
        tab: 'movies' as const,
      };
      await recordPlaybackExit(session, 900, 1000);
    }
    profile = await readProfile();
    assert.equal(profile.familiarity.completed_watches, FRIEND_COMPLETED_WATCHES);
    assert.equal(profile.familiarity.stage, 'friend');
  });
});

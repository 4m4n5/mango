import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendJournalEvent, journalHasPlayCompleted, listJournalEvents, resetJournalForTests, rollUpJournalEvents } from './journal.js';

function withCompanionDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'mango-companion-journal-'));
  const previous = process.env.MANGO_COMPANION_DIR;
  process.env.MANGO_COMPANION_DIR = dir;
  try {
    run(dir);
  } finally {
    resetJournalForTests();
    if (previous === undefined) delete process.env.MANGO_COMPANION_DIR;
    else process.env.MANGO_COMPANION_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('appendJournalEvent and listJournalEvents round-trip', () => {
  withCompanionDir(() => {
    appendJournalEvent('voice_turn', { transcript: 'hello' });
    appendJournalEvent('profile_patch', { field: 'facts' });
    const events = listJournalEvents(10);
    assert.equal(events.length, 2);
    assert.equal(events[0].event_type, 'profile_patch');
    assert.equal(events[1].event_type, 'voice_turn');
  });
});

test('rollUpJournalEvents prunes old raw events and keeps rollup summary', () => {
  withCompanionDir(() => {
    appendJournalEvent('voice_turn', { transcript: 'old' });
    const dbPath = path.join(process.env.MANGO_COMPANION_DIR!, 'companion.db');
    const db = new Database(dbPath);
    db.prepare(
      "UPDATE journal_events SET created_at = '2020-01-01T00:00:00.000Z' WHERE event_type = 'voice_turn'",
    ).run();
    db.close();

    const rollup = rollUpJournalEvents(90);
    assert.ok(rollup.pruned >= 1);
    assert.equal(rollup.rolled_up.voice_turn, 1);

    const events = listJournalEvents(20);
    assert.ok(events.some((event) => event.event_type === 'journal_rollup'));
    assert.ok(!events.some((event) => event.event_type === 'voice_turn' && event.payload.transcript === 'old'));
  });
});

test('journalHasPlayCompleted detects play_completed by content_key', () => {
  withCompanionDir(() => {
    appendJournalEvent('play_completed', { content_key: 'movie:tt123', title_id: 'tt123' });
    assert.equal(journalHasPlayCompleted('movie:tt123'), true);
    assert.equal(journalHasPlayCompleted('movie:tt999'), false);
  });
});

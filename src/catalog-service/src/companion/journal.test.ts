import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendJournalEvent, listJournalEvents, resetJournalForTests } from './journal.js';

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

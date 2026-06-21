import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractPreferencePatches, processLightReflect } from './reflect.js';
import { readProfile } from './profile.js';
import { listJournalEvents, resetJournalForTests } from './journal.js';

function withCompanionDir(run: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mango-companion-reflect-'));
  const previous = process.env.MANGO_COMPANION_DIR;
  process.env.MANGO_COMPANION_DIR = dir;
  return run().finally(() => {
    resetJournalForTests();
    if (previous === undefined) delete process.env.MANGO_COMPANION_DIR;
    else process.env.MANGO_COMPANION_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

test('extractPreferencePatches finds loves and avoids', () => {
  assert.deepEqual(extractPreferencePatches('I hate horror movies').append_avoids, ['horror movies']);
  assert.deepEqual(extractPreferencePatches('I love sci-fi').append_loves, ['sci-fi']);
});

test('processLightReflect skips very short utterances', async () => {
  await withCompanionDir(async () => {
    const result = await processLightReflect({ transcript: 'hi' });
    assert.equal(result.skipped, true);
    assert.equal(listJournalEvents(5).length, 0);
  });
});

test('processLightReflect journals and bumps sessions', async () => {
  await withCompanionDir(async () => {
    await processLightReflect({
      transcript: 'what are some good hindi movies',
      reply: 'Kuch light ya serious?',
      tools_used: [],
    });
    const profile = await readProfile();
    assert.equal(profile.familiarity.sessions, 1);
    assert.ok(listJournalEvents(5).some((e) => e.event_type === 'voice_turn'));
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  normalizeProfile,
  patchProfile,
  profileSummary,
  readProfile,
  writeProfile,
} from './profile.js';
import { defaultProfile, TITLE_LOVES_CAP } from './types.js';

function withCompanionDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mango-companion-'));
  const previous = process.env.MANGO_COMPANION_DIR;
  process.env.MANGO_COMPANION_DIR = dir;
  return run(dir).finally(() => {
    if (previous === undefined) delete process.env.MANGO_COMPANION_DIR;
    else process.env.MANGO_COMPANION_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

test('default profile round-trips through yaml', async () => {
  await withCompanionDir(async () => {
    const written = await writeProfile(defaultProfile());
    const read = await readProfile();
    assert.equal(read.version, written.version);
    assert.equal(read.familiarity.stage, 'stranger');
  });
});

test('patchProfile appends facts and caps title loves', async () => {
  await withCompanionDir(async () => {
    await writeProfile(defaultProfile());
    const patched = await patchProfile({
      append_facts: ['prefers light weeknight comedies'],
      append_loves: ['comedy'],
      append_title_loves: [{ type: 'movie', id: 'tt1', title: 'Test Movie' }],
      familiarity: { sessions: 3 },
    });
    assert.equal(patched.familiarity.sessions, 3);
    assert.ok(patched.facts.includes('prefers light weeknight comedies'));
    assert.ok(patched.taste.loves.includes('comedy'));
    assert.equal(patched.taste.title_loves.length, 1);

    const many = Array.from({ length: TITLE_LOVES_CAP + 5 }, (_, i) => ({
      type: 'movie',
      id: `tt${i}`,
      title: `Title ${i}`,
    }));
    const capped = await patchProfile({ append_title_loves: many });
    assert.equal(capped.taste.title_loves.length, TITLE_LOVES_CAP);
  });
});

test('profileSummary is human readable', () => {
  const profile = defaultProfile();
  profile.taste.loves = ['comedy', 'sci-fi'];
  profile.familiarity.sessions = 2;
  const summary = profileSummary(profile);
  assert.match(summary, /comedy/);
  assert.match(summary, /2 sessions/);
});

test('normalizeProfile tolerates partial yaml', () => {
  const profile = normalizeProfile({ familiarity: { stage: 'friend', sessions: 10 } });
  assert.equal(profile.familiarity.stage, 'friend');
  assert.equal(profile.familiarity.sessions, 10);
});

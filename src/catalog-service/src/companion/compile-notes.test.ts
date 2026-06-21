import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileNotesFromProfile, compiledNotesExcerpt } from './compile-notes.js';
import { defaultProfile } from './types.js';

test('compileNotesFromProfile includes loves and facts', () => {
  const profile = defaultProfile();
  profile.taste.loves = ['Hindi comedy'];
  profile.facts = ['dislikes horror'];
  const md = compileNotesFromProfile(profile);
  assert.match(md, /Hindi comedy/);
  assert.match(md, /dislikes horror/);
});

test('compiledNotesExcerpt truncates long markdown', () => {
  const long = 'a'.repeat(2000);
  const excerpt = compiledNotesExcerpt(long, 100);
  assert.ok(excerpt.length <= 102);
  assert.match(excerpt, /…$/);
});

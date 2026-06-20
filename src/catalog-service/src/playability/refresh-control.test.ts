import test from 'node:test';
import assert from 'node:assert/strict';
import { getRefreshLevel, listRefreshLevels } from '../playability/refresh-control.js';

test('listRefreshLevels exposes LLM hints and estimates', () => {
  const levels = listRefreshLevels();
  assert.ok(levels.length >= 4);
  const shuffle = getRefreshLevel('shuffle_rails');
  assert.ok(shuffle);
  assert.equal(shuffle?.blocks_couch, false);
  assert.ok(shuffle?.llm_hint.length > 10);
  const full = getRefreshLevel('full_maintenance');
  assert.ok(full?.blocks_couch);
  assert.ok(full!.estimated_sec > shuffle!.estimated_sec);
});

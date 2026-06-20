import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLlmRefreshToolManifest,
  getRefreshLevel,
  listRefreshLevelsForUi,
} from '../playability/refresh-control.js';

test('listRefreshLevelsForUi orders quick before overnight', () => {
  const levels = listRefreshLevelsForUi();
  assert.equal(levels[0]?.id, 'quick_topup');
  assert.equal(levels.at(-1)?.id, 'overnight_grow');
});

test('listRefreshLevels exposes LLM hints and estimates', () => {
  const levels = listRefreshLevelsForUi();
  assert.ok(levels.length >= 4);
  const shuffle = getRefreshLevel('shuffle_rails');
  assert.ok(shuffle);
  assert.equal(shuffle?.blocks_couch, false);
  assert.ok(shuffle?.llm_hint.length > 10);
  const full = getRefreshLevel('full_maintenance');
  assert.ok(full?.blocks_couch);
  assert.ok(full!.estimated_sec > shuffle!.estimated_sec);
  const overnight = getRefreshLevel('overnight_grow');
  assert.ok(overnight);
  assert.equal(overnight?.category, 'overnight');
});

test('buildLlmRefreshToolManifest exposes actionable levels for voice tools', () => {
  const manifest = buildLlmRefreshToolManifest();
  assert.equal(manifest.tool_name, 'mango_playability_refresh');
  assert.ok(manifest.parameters.properties.level.enum.includes('quick_topup'));
  assert.ok(!manifest.parameters.properties.level.enum.includes('shuffle_rails'));
  assert.equal(manifest.levels.length, manifest.parameters.properties.level.enum.length);
});

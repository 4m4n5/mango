import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLlmRefreshToolManifest,
  getRefreshLevel,
  listRefreshLevelsForUi,
  resolveRefreshLevelId,
} from '../playability/refresh-control.js';

test('listRefreshLevelsForUi orders quick before overnight', () => {
  const levels = listRefreshLevelsForUi();
  assert.equal(levels[0]?.id, 'grow_quick');
  assert.equal(levels.at(-1)?.id, 'grow_overnight');
});

test('legacy refresh level ids resolve to canonical levels', () => {
  assert.equal(resolveRefreshLevelId('quick_topup'), 'grow_quick');
  assert.equal(resolveRefreshLevelId('full_maintenance'), 'grow_nightly');
  assert.equal(resolveRefreshLevelId('overnight_grow'), 'grow_overnight');
  assert.equal(getRefreshLevel('quick_topup')?.id, 'grow_quick');
});

test('listRefreshLevels exposes LLM hints and estimates', () => {
  const levels = listRefreshLevelsForUi();
  assert.equal(levels.length, 4);
  const shuffle = getRefreshLevel('shuffle_rails');
  assert.ok(shuffle);
  assert.equal(shuffle?.blocks_couch, false);
  assert.ok(shuffle?.llm_hint.length > 10);
  const nightly = getRefreshLevel('grow_nightly');
  assert.ok(nightly?.blocks_couch);
  assert.ok(nightly!.estimated_sec > shuffle!.estimated_sec);
  const overnight = getRefreshLevel('grow_overnight');
  assert.ok(overnight);
  assert.equal(overnight?.category, 'overnight');
});

test('buildLlmRefreshToolManifest exposes actionable levels for voice tools', () => {
  const manifest = buildLlmRefreshToolManifest();
  assert.equal(manifest.tool_name, 'mango_playability_refresh');
  const levelEnum = manifest.parameters.properties.level.enum;
  assert.ok(levelEnum.includes('grow_quick'));
  assert.ok(levelEnum.includes('quick_topup'));
  assert.ok(!levelEnum.includes('shuffle_rails'));
  assert.equal(manifest.levels.length, 4);
});

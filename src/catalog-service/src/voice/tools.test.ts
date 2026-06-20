import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceToolManifest } from './tools.js';

test('buildVoiceToolManifest exposes browse-only voice tools (no play)', () => {
  const manifest = buildVoiceToolManifest();
  const names = manifest.tools.map((tool) => tool.name);
  assert.ok(names.includes('mango_open_title'));
  assert.ok(names.includes('mango_search'));
  assert.ok(names.includes('mango_navigate'));
  assert.ok(names.includes('mango_library_overview'));
  assert.ok(names.includes('mango_search_external'));
  assert.ok(!names.includes('mango_play'));
  assert.ok(!names.includes('mango_play_continue'));
  const openTitle = manifest.tools.find((tool) => tool.name === 'mango_open_title');
  assert.equal(openTitle?.layer, 'launcher');
  const refresh = manifest.tools.find((tool) => tool.name === 'mango_playability_refresh');
  assert.equal(refresh?.requires_confirm, true);
});

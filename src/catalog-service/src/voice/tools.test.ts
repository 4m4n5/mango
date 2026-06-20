import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceToolManifest } from './tools.js';

test('buildVoiceToolManifest exposes tier-0 voice tools', () => {
  const manifest = buildVoiceToolManifest();
  const names = manifest.tools.map((tool) => tool.name);
  assert.ok(names.includes('mango_play'));
  assert.ok(names.includes('mango_search'));
  assert.ok(names.includes('mango_navigate'));
  assert.ok(names.includes('mango_playability_refresh'));
  const refresh = manifest.tools.find((tool) => tool.name === 'mango_playability_refresh');
  assert.equal(refresh?.requires_confirm, true);
  const navigate = manifest.tools.find((tool) => tool.name === 'mango_navigate');
  assert.equal(navigate?.layer, 'launcher');
});

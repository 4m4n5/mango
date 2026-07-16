import test from 'node:test';
import assert from 'node:assert/strict';
import { liveSearchValidationDecision } from './search-validation-policy.js';

test('AREA69 search validation is never allowed while Mango playback is active', () => {
  assert.deepEqual(liveSearchValidationDecision('area69:9001', true), {
    allowed: false,
    reason: 'area69_playback_active',
  });
  assert.deepEqual(liveSearchValidationDecision('area69:9001', false), {
    allowed: true,
  });
});

test('free IPTV background validation also yields to active foreground playback', () => {
  assert.deepEqual(liveSearchValidationDecision('free:news', true), {
    allowed: false,
    reason: 'playback_active',
  });
});

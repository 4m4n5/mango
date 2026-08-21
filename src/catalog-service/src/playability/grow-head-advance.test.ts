import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldHeadAdvanceOnTombstoneSkew } from './grow-head-advance.js';

test('shouldHeadAdvanceOnTombstoneSkew when tombstones dominate and no fresh queued', () => {
  assert.equal(
    shouldHeadAdvanceOnTombstoneSkew({ fresh_queued: 0, skipped_recent_failed: 19 }, 40, 0.5),
    false,
  );
  assert.equal(
    shouldHeadAdvanceOnTombstoneSkew({ fresh_queued: 0, skipped_recent_failed: 20 }, 40, 0.5),
    true,
  );
  assert.equal(
    shouldHeadAdvanceOnTombstoneSkew({ fresh_queued: 3, skipped_recent_failed: 30 }, 40, 0.5),
    false,
  );
});

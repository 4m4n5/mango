import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLibraryVerifyState } from './external.js';

test('deriveLibraryVerifyState marks verified titles in_library and not queued', () => {
  assert.deepEqual(deriveLibraryVerifyState('verified'), { inLibrary: true, alreadyQueued: false });
});

test('deriveLibraryVerifyState surfaces an already-pending title as queued_for_verify', () => {
  assert.deepEqual(deriveLibraryVerifyState('pending'), { inLibrary: false, alreadyQueued: true });
});

test('deriveLibraryVerifyState treats failed, stale, and absent titles as neither in_library nor queued', () => {
  assert.deepEqual(deriveLibraryVerifyState('failed'), { inLibrary: false, alreadyQueued: false });
  assert.deepEqual(deriveLibraryVerifyState('stale'), { inLibrary: false, alreadyQueued: false });
  assert.deepEqual(deriveLibraryVerifyState(undefined), { inLibrary: false, alreadyQueued: false });
});

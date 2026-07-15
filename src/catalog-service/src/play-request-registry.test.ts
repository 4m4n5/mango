import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activePlayRequestEpochForTest,
  finishPlayRequest,
  normalizePlayRequestId,
  registerPlayRequest,
  resetPlayRequestRegistryForTest,
} from './play-request-registry.js';

test.beforeEach(() => resetPlayRequestRegistryForTest());

test('play request ids are bounded and safe for structured logs', () => {
  assert.equal(normalizePlayRequestId('play-12345678'), 'play-12345678');
  assert.equal(normalizePlayRequestId('short'), null);
  assert.equal(normalizePlayRequestId('bad request id'), null);
});

test('finishing an older epoch cannot remove a replacement request', () => {
  registerPlayRequest('play-12345678', 10);
  registerPlayRequest('play-12345678', 11);
  finishPlayRequest('play-12345678', 10);
  assert.equal(activePlayRequestEpochForTest('play-12345678'), 11);
  finishPlayRequest('play-12345678', 11);
  assert.equal(activePlayRequestEpochForTest('play-12345678'), undefined);
});

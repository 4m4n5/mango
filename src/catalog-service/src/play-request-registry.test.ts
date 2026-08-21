import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetPlayEpochForTest } from './play-cancel.js';
import {
  activePlayRequestEpochForTest,
  cancelPlayRequest,
  finishPlayRequest,
  normalizePlayRequestId,
  registerPlayRequest,
  resetPlayRequestRegistryForTest,
} from './play-request-registry.js';

const priorCancelPath = process.env.MANGO_PLAY_CANCEL_PATH;
let cancelDir = '';

test.beforeEach(async () => {
  cancelDir = await mkdtemp(join(tmpdir(), 'mango-play-request-registry-'));
  process.env.MANGO_PLAY_CANCEL_PATH = join(cancelDir, 'play-cancel.epoch');
  resetPlayRequestRegistryForTest();
  await resetPlayEpochForTest();
});

test.afterEach(async () => {
  resetPlayRequestRegistryForTest();
  await resetPlayEpochForTest();
  if (priorCancelPath === undefined) delete process.env.MANGO_PLAY_CANCEL_PATH;
  else process.env.MANGO_PLAY_CANCEL_PATH = priorCancelPath;
  await rm(cancelDir, { recursive: true, force: true });
});

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

test('cancel reports successful completion only for the exact finished request', async () => {
  registerPlayRequest('play-success-123', 10);
  finishPlayRequest('play-success-123', 10, true);
  assert.deepEqual(await cancelPlayRequest('play-success-123'), {
    cancelled: false,
    finished_successfully: true,
    epoch: 0,
  });
  assert.deepEqual(await cancelPlayRequest('play-unknown-123'), {
    cancelled: false,
    finished_successfully: false,
    epoch: 0,
  });
});

test('failed or actively cancelled requests never report successful completion', async () => {
  registerPlayRequest('play-failed-1234', 10);
  finishPlayRequest('play-failed-1234', 10, false);
  assert.equal((await cancelPlayRequest('play-failed-1234')).finished_successfully, false);

  registerPlayRequest('play-active-1234', 0);
  const cancelled = await cancelPlayRequest('play-active-1234');
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.finished_successfully, false);
  assert.ok(cancelled.epoch > 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { playLiveCandidateLadder } from './playback-ladder.js';

test('live playback ladder records a failed variant and plays the next qualified alternative', async () => {
  const played: string[] = [];
  const outcomes: Array<[string, string, string]> = [];
  const result = await playLiveCandidateLadder([
    { url: 'https://stream.invalid/4k', live_channel_id: 'f1-4k', live_channel_source: 'free' },
    { url: 'https://stream.invalid/1080', live_channel_id: 'f1-hd', live_channel_source: 'area69' },
  ], 'f1', {
    remainingMs: () => 10_000,
    probeTimeoutMs: 5_000,
    probe: async () => true,
    play: async (url) => {
      played.push(url);
      if (url.endsWith('/4k')) throw new Error('decoder failed at https://secret.invalid/token');
      return { ok: true };
    },
    record: async (source, id, status) => {
      outcomes.push([source, id, status]);
    },
    isCancelled: () => false,
  });
  assert.equal(result.candidate?.live_channel_id, 'f1-hd');
  assert.equal(result.attempts, 2);
  assert.deepEqual(played, [
    'https://stream.invalid/4k',
    'https://stream.invalid/1080',
  ]);
  assert.deepEqual(outcomes, [
    ['free', 'f1-4k', 'failed'],
    ['area69', 'f1-hd', 'verified'],
  ]);
  assert.deepEqual(result.errors, ['f1-4k: playback start failed']);
});

test('live playback ladder stops before probing when the shared deadline is exhausted', async () => {
  let probes = 0;
  const result = await playLiveCandidateLadder([
    { url: 'https://stream.invalid/live' },
  ], 'live', {
    remainingMs: () => 0,
    probeTimeoutMs: 5_000,
    probe: async () => { probes += 1; return true; },
    play: async () => ({ ok: true }),
    record: async () => undefined,
    isCancelled: () => false,
  });
  assert.equal(probes, 0);
  assert.equal(result.exhausted, true);
});

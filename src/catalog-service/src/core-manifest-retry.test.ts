import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogError, fetchManifestAtBoot } from './core.js';

test('loopback manifest boot retries inside one bounded deadline', async () => {
  let clock = 0;
  let attempts = 0;
  const result = await fetchManifestAtBoot('http://127.0.0.1:3035/manifest.json', {
    deadlineAt: 100,
    retryDelayMs: 10,
    now: () => clock,
    wait: async (delayMs) => { clock += delayMs; },
    fetcher: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('fetch failed');
      return { name: 'AIOStreams' };
    },
  });
  assert.deepEqual(result, { name: 'AIOStreams' });
  assert.equal(attempts, 3);
  assert.equal(clock, 20);
});

test('remote manifests remain single-attempt and loopback retries remain bounded', async () => {
  let remoteAttempts = 0;
  await assert.rejects(fetchManifestAtBoot('https://example.com/manifest.json', {
    deadlineAt: 100,
    retryDelayMs: 10,
    now: () => 0,
    wait: async () => undefined,
    fetcher: async () => {
      remoteAttempts += 1;
      throw new Error('fetch failed');
    },
  }), /fetch failed/);
  assert.equal(remoteAttempts, 1);

  let localAttempts = 0;
  await assert.rejects(fetchManifestAtBoot('http://localhost:3036/manifest.json', {
    deadlineAt: 0,
    retryDelayMs: 10,
    now: () => 0,
    wait: async () => undefined,
    fetcher: async () => {
      localAttempts += 1;
      throw new Error('fetch failed');
    },
  }), /fetch failed/);
  assert.equal(localAttempts, 1);
});

test('a permanently broken local manifest fails fast instead of stalling boot', async () => {
  let notFoundAttempts = 0;
  await assert.rejects(fetchManifestAtBoot('http://127.0.0.1:3035/manifest.json', {
    deadlineAt: 60_000,
    retryDelayMs: 10,
    now: () => 0,
    wait: async () => { throw new Error('must not wait on a permanent failure'); },
    fetcher: async () => {
      notFoundAttempts += 1;
      throw new CatalogError(404, 'manifest.json not found');
    },
  }), /manifest.json not found/);
  assert.equal(notFoundAttempts, 1);

  let malformedAttempts = 0;
  await assert.rejects(fetchManifestAtBoot('http://127.0.0.1:3035/manifest.json', {
    deadlineAt: 60_000,
    retryDelayMs: 10,
    now: () => 0,
    wait: async () => { throw new Error('must not wait on a permanent failure'); },
    fetcher: async () => {
      malformedAttempts += 1;
      throw new Error('manifest.json is not valid JSON');
    },
  }), /not valid JSON/);
  assert.equal(malformedAttempts, 1);
});

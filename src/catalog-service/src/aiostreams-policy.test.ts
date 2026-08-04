import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { targetPolicyExcludesUncached, validateAioStreamsTargetPolicy } from './aiostreams-policy.js';

test('S3: target policy retains uncached TorBox and excludes uncached Real-Debrid', async () => {
  const repoDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
  const policy = JSON.parse(await readFile(resolve(repoDir, 'config/aiostreams-target-patch.json'), 'utf8'));
  assert.doesNotThrow(() => validateAioStreamsTargetPolicy(policy));
  assert.equal(targetPolicyExcludesUncached(policy, 'torbox'), false);
  assert.equal(targetPolicyExcludesUncached(policy, 'realdebrid'), true);
});

test('S3: AIOStreams OR semantics reject an all-debrid uncached exclusion', () => {
  assert.throws(() => validateAioStreamsTargetPolicy({
    excludeUncachedFromServices: ['realdebrid'],
    excludeUncachedFromStreamTypes: ['debrid'],
  }), /retain uncached TorBox/);
});

test('W2: target policy rejects persisted global and AND-mode overrides', () => {
  assert.throws(() => validateAioStreamsTargetPolicy({
    excludeUncached: true,
    excludeUncachedMode: 'or',
    excludeUncachedFromServices: ['realdebrid'],
    excludeUncachedFromStreamTypes: [],
  }), /must not exclude every uncached stream/);
  assert.throws(() => validateAioStreamsTargetPolicy({
    excludeUncached: false,
    excludeUncachedMode: 'and',
    excludeUncachedFromServices: ['realdebrid'],
    excludeUncachedFromStreamTypes: [],
  }), /requires OR cache-filter semantics/);
});

test('Alliance: target policy exposes stream errors while non-stream resources stay quiet', () => {
  const base = {
    excludeUncached: false,
    excludeUncachedMode: 'or',
    excludeUncachedFromServices: ['realdebrid'],
    excludeUncachedFromStreamTypes: [],
  };
  assert.throws(() => validateAioStreamsTargetPolicy({
    ...base,
    hideErrors: true,
  }), /expose stream errors/);
  assert.throws(() => validateAioStreamsTargetPolicy({
    ...base,
    hideErrors: false,
    hideErrorsForResources: ['stream'],
  }), /must not hide stream errors/);
  assert.doesNotThrow(() => validateAioStreamsTargetPolicy({
    ...base,
    hideErrors: false,
    hideErrorsForResources: ['catalog', 'meta', 'subtitles', 'addon_catalog'],
  }));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { playabilityPolicySnapshot, validatePlayabilityPolicy } from './policy.js';

test('repository playability policy is schema-valid and hashable', () => {
  const snapshot = playabilityPolicySnapshot();
  assert.equal(snapshot.policy.nightly.deadline_minutes, 150);
  assert.match(snapshot.policy_hash, /^[a-f0-9]{64}$/);
});

test('policy rejects unknown toggles and unsafe publication reserve', () => {
  const valid = playabilityPolicySnapshot().policy;
  assert.throws(() => validatePlayabilityPolicy({ ...valid, surprise_flag: true }), /keys invalid/);
  assert.throws(() => validatePlayabilityPolicy({
    ...valid,
    nightly: { ...valid.nightly, admission_stop_minutes: 145 },
  }), /reserve at least 10 minutes/);
});

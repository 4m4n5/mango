import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogError } from './catalog-errors.js';
import {
  assertExpectedPersonalization,
  parseExpectedPersonalization,
  parseExpectedPersonalizationBody,
} from './personalization-request.js';

function assertCatalogError(fn: () => unknown, status: number): void {
  assert.throws(fn, (error: unknown) => error instanceof CatalogError && error.status === status);
}

test('profile expectation is optional but never partially accepted', () => {
  assert.equal(parseExpectedPersonalization(new URLSearchParams()), null);
  assertCatalogError(
    () => parseExpectedPersonalization(new URLSearchParams({ expected_profile_id: 'alice' })),
    400,
  );
  assertCatalogError(
    () => parseExpectedPersonalization(new URLSearchParams({
      expected_personalization_updated_at: '7',
    })),
    400,
  );
});

test('profile expectation normalizes the owner and accepts only canonical integers', () => {
  assert.deepEqual(parseExpectedPersonalization(new URLSearchParams({
    expected_profile_id: ' Alice ',
    expected_personalization_updated_at: '7',
  })), {
    active_profile_id: 'alice',
    updated_at: 7,
  });
  for (const revision of ['', ' ', '-0', '1.0', '1e0', '-1', '9007199254740992']) {
    assertCatalogError(() => parseExpectedPersonalization(new URLSearchParams({
      expected_profile_id: 'alice',
      expected_personalization_updated_at: revision,
    })), 400);
  }
});

test('JSON mutation expectations use the same exact pair and integer contract', () => {
  assert.equal(parseExpectedPersonalizationBody({}), null);
  assertCatalogError(() => parseExpectedPersonalizationBody({
    expected_profile_id: 'alice',
  }), 400);
  assertCatalogError(() => parseExpectedPersonalizationBody({
    expected_personalization_updated_at: 7,
  }), 400);
  assert.deepEqual(parseExpectedPersonalizationBody({
    expected_profile_id: ' Alice ',
    expected_personalization_updated_at: 7,
  }), {
    active_profile_id: 'alice',
    updated_at: 7,
  });
  for (const revision of [null, true, '', ' ', -1, 1.5, '1.0', '1e0']) {
    assertCatalogError(() => parseExpectedPersonalizationBody({
      expected_profile_id: 'alice',
      expected_personalization_updated_at: revision,
    }), 400);
  }
});

test('expected owner fails closed on either a profile or revision change', () => {
  const expected = { active_profile_id: 'alice', updated_at: 7 };
  assert.doesNotThrow(() => assertExpectedPersonalization(expected, { ...expected }, 'during test'));
  assertCatalogError(() => assertExpectedPersonalization(
    expected,
    { active_profile_id: 'bob', updated_at: 7 },
    'during test',
  ), 409);
  assertCatalogError(() => assertExpectedPersonalization(
    expected,
    { active_profile_id: 'alice', updated_at: 8 },
    'during test',
  ), 409);
});

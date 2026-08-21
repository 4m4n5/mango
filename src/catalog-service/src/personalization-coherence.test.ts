import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PersonalizationChangedDuringRequestError,
  personalizationScopedCacheKey,
  runPersonalizationCoherentRequest,
  samePersonalizationSnapshot,
  type PersonalizationSnapshot,
} from './personalization-coherence.js';

const household: PersonalizationSnapshot = {
  active_profile_id: 'household',
  updated_at: 10,
};
const alice: PersonalizationSnapshot = {
  active_profile_id: 'alice',
  updated_at: 11,
};
const bob: PersonalizationSnapshot = {
  active_profile_id: 'bob',
  updated_at: 12,
};

test('profile-scoped cache identity includes owner and personalization revision', () => {
  assert.equal(samePersonalizationSnapshot(household, { ...household }), true);
  assert.equal(samePersonalizationSnapshot(household, alice), false);
  assert.notEqual(
    personalizationScopedCacheKey('movies', household),
    personalizationScopedCacheKey('movies', alice),
  );
  assert.notEqual(
    personalizationScopedCacheKey('movies', household),
    personalizationScopedCacheKey('movies', { ...household, updated_at: 99 }),
  );
  assert.notEqual(
    personalizationScopedCacheKey('movies', household),
    personalizationScopedCacheKey('series', household),
  );
});

test('a profile switch discards the first build and commits only the retry owner', async () => {
  let current = household;
  const built: string[] = [];
  const committed: string[] = [];
  const result = await runPersonalizationCoherentRequest({
    readSnapshot: () => current,
    build: async (snapshot, attempt) => {
      built.push(snapshot.active_profile_id);
      if (attempt === 0) current = alice;
      return {
        value: snapshot.active_profile_id,
        commit: () => committed.push(snapshot.active_profile_id),
      };
    },
  });

  assert.deepEqual(built, ['household', 'alice']);
  assert.deepEqual(committed, ['alice']);
  assert.equal(result.value, 'alice');
  assert.deepEqual(result.snapshot, alice);
});

test('a second profile change fails closed without committing either result', async () => {
  let current = household;
  const committed: string[] = [];
  await assert.rejects(
    runPersonalizationCoherentRequest({
      readSnapshot: () => current,
      build: async (snapshot, attempt) => {
        current = attempt === 0 ? alice : bob;
        return {
          value: snapshot.active_profile_id,
          commit: () => committed.push(snapshot.active_profile_id),
        };
      },
    }),
    PersonalizationChangedDuringRequestError,
  );
  assert.deepEqual(committed, []);
});

test('a change during cache commit rolls back the stale write before retrying', async () => {
  let current = household;
  const cache = new Map<string, string>();
  const result = await runPersonalizationCoherentRequest({
    readSnapshot: () => current,
    build: async (snapshot, attempt) => {
      const key = personalizationScopedCacheKey('movies', snapshot);
      return {
        value: snapshot.active_profile_id,
        commit: () => {
          cache.set(key, snapshot.active_profile_id);
          if (attempt === 0) current = alice;
        },
        rollback: () => cache.delete(key),
      };
    },
  });

  assert.equal(result.value, 'alice');
  assert.deepEqual([...cache.values()], ['alice']);
  assert.equal(cache.has(personalizationScopedCacheKey('movies', household)), false);
});

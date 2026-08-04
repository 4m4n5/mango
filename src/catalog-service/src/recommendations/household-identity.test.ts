import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activateViewerProfile,
  createViewerProfile,
  getPersonalizationState,
  initLibraryDb,
  listViewerProfiles,
  resetLibraryDbForTests,
  setViewerMood,
} from '../library/db.js';
import {
  householdOnlyMutationError,
  preserveHouseholdMoodClear,
  reconcileHouseholdRecommendationIdentity,
} from './household-identity.js';

function withLibrary(run: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'mango-household-identity-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'pins.json');
  resetLibraryDbForTests();
  try {
    initLibraryDb();
    run();
  } finally {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Household serve mode preserves and restores dormant profile and mood state', () => withLibrary(() => {
  const personal = createViewerProfile('Aman');
  activateViewerProfile(personal.profile_id);
  setViewerMood('deep', 10_000);
  const now = Date.now();

  const household = reconcileHouseholdRecommendationIdentity(true, now);
  assert.equal(household.active_profile_id, 'household');
  assert.equal(household.mood, null, 'serve mode must clear mood from live recommendation identity');
  assert.equal(listViewerProfiles().some((profile) => profile.profile_id === personal.profile_id), true);

  const restored = reconcileHouseholdRecommendationIdentity(false, now + 1);
  assert.equal(restored.active_profile_id, personal.profile_id);
  assert.equal(restored.mood, 'deep');
}));

test('an explicit Household-mode mood clear remains cleared after rollback', () => withLibrary(() => {
  const personal = createViewerProfile('Aman');
  activateViewerProfile(personal.profile_id);
  setViewerMood('deep', 10_000);
  const now = Date.now();
  reconcileHouseholdRecommendationIdentity(true, now);
  setViewerMood(null);
  preserveHouseholdMoodClear(now + 1);
  const restored = reconcileHouseholdRecommendationIdentity(false, now + 2);
  assert.equal(restored.active_profile_id, personal.profile_id);
  assert.equal(restored.mood, null);
  assert.equal(getPersonalizationState(now + 2).mood, null);
}));

test('Household-only mutation policy is typed and Household activation is idempotent', () => {
  assert.equal(householdOnlyMutationError(true, 'profile_activate', 'household'), null);
  assert.equal(householdOnlyMutationError(true, 'mood_write', ''), null);
  assert.equal(householdOnlyMutationError(true, 'profile_create')?.code, 'household_only');
  assert.equal(householdOnlyMutationError(true, 'profile_activate', 'personal')?.code, 'household_only');
  assert.equal(householdOnlyMutationError(true, 'mood_write', 'deep')?.code, 'household_only');
  assert.equal(householdOnlyMutationError(false, 'profile_create'), null);
});

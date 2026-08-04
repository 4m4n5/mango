import {
  getPersonalizationState,
  libraryDatabase,
  type PersonalizationState,
} from '../library/db.js';

const DORMANT_PERSONALIZATION_KEY = 'recommendations:dormant_personalization';

type DormantPersonalization = Pick<
  PersonalizationState,
  'active_profile_id' | 'mood' | 'mood_started_at' | 'mood_expires_at'
>;

function readDormantPersonalization(): DormantPersonalization | null {
  const row = libraryDatabase().prepare(`
SELECT value_json FROM recommendation_runtime_state WHERE state_key = ?
`).get(DORMANT_PERSONALIZATION_KEY) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value_json) as Partial<DormantPersonalization>;
    if (typeof parsed.active_profile_id !== 'string' || !parsed.active_profile_id.trim()) return null;
    return {
      active_profile_id: parsed.active_profile_id,
      mood: typeof parsed.mood === 'string' ? parsed.mood : null,
      mood_started_at: Number.isFinite(parsed.mood_started_at) ? Number(parsed.mood_started_at) : null,
      mood_expires_at: Number.isFinite(parsed.mood_expires_at) ? Number(parsed.mood_expires_at) : null,
    };
  } catch {
    return null;
  }
}

function writeDormantPersonalization(state: DormantPersonalization, at: number): void {
  libraryDatabase().prepare(`
INSERT INTO recommendation_runtime_state(state_key, value_json, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
`).run(DORMANT_PERSONALIZATION_KEY, JSON.stringify(state), at);
}

/**
 * Switch recommendation ownership without deleting the dormant profile or mood.
 * Disabling Household-only mode restores the exact prior owner and unexpired
 * mood, making the rollout flag a genuine rollback boundary.
 */
export function reconcileHouseholdRecommendationIdentity(
  householdOnly: boolean,
  at = Date.now(),
): PersonalizationState {
  const db = libraryDatabase();
  const current = getPersonalizationState(at);
  if (householdOnly) {
    db.transaction(() => {
      if (!readDormantPersonalization()) {
        writeDormantPersonalization({
          active_profile_id: current.active_profile_id,
          mood: current.mood,
          mood_started_at: current.mood_started_at,
          mood_expires_at: current.mood_expires_at,
        }, at);
      }
      // Mood remains recoverable in the dormant snapshot, but must not remain
      // live while Household v2 owns recommendation identity. Clearing all
      // active fields also keeps utility/cache callers from accidentally
      // carrying a personal mood into a Household read.
      db.prepare(`
UPDATE personalization_state
SET active_profile_id = 'household', mood = NULL, mood_started_at = NULL,
    mood_expires_at = NULL, updated_at = MAX(updated_at + 1, ?)
WHERE state_id = 1
  AND (active_profile_id != 'household' OR mood IS NOT NULL
       OR mood_started_at IS NOT NULL OR mood_expires_at IS NOT NULL)
`).run(at);
    })();
    return getPersonalizationState(at);
  }

  const dormant = readDormantPersonalization();
  if (!dormant) return current;
  const profileExists = db.prepare('SELECT 1 FROM viewer_profiles WHERE profile_id = ?')
    .get(dormant.active_profile_id);
  const moodUnexpired = dormant.mood !== null
    && dormant.mood_expires_at !== null
    && dormant.mood_expires_at > at;
  db.transaction(() => {
    db.prepare(`
UPDATE personalization_state
SET active_profile_id = ?, mood = ?, mood_started_at = ?, mood_expires_at = ?,
    updated_at = MAX(updated_at + 1, ?)
WHERE state_id = 1
`).run(
      profileExists ? dormant.active_profile_id : 'household',
      moodUnexpired ? dormant.mood : null,
      moodUnexpired ? dormant.mood_started_at : null,
      moodUnexpired ? dormant.mood_expires_at : null,
      at,
    );
    db.prepare('DELETE FROM recommendation_runtime_state WHERE state_key = ?')
      .run(DORMANT_PERSONALIZATION_KEY);
  })();
  return getPersonalizationState(at);
}

/** Keep an explicit clear made during Household-only mode across rollback. */
export function preserveHouseholdMoodClear(at = Date.now()): void {
  const dormant = readDormantPersonalization();
  if (!dormant) return;
  writeDormantPersonalization({
    ...dormant,
    mood: null,
    mood_started_at: null,
    mood_expires_at: null,
  }, at);
}

export type HouseholdOnlyMutation = 'profile_create' | 'profile_activate' | 'mood_write';

export function householdOnlyMutationError(
  householdOnly: boolean,
  mutation: HouseholdOnlyMutation,
  value = '',
): { code: 'household_only'; error: string } | null {
  if (!householdOnly) return null;
  if (mutation === 'profile_activate' && value.trim().toLowerCase() === 'household') return null;
  if (mutation === 'mood_write' && !value.trim()) return null;
  return {
    code: 'household_only',
    error: mutation === 'mood_write'
      ? 'Mood is not used by Household recommendations.'
      : 'Recommendations now use one Household taste.',
  };
}

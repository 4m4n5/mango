import { CatalogError } from './catalog-errors.js';
import type { PersonalizationSnapshot } from './personalization-coherence.js';

/**
 * Parse the optional client ownership handshake. The fields are a pair: a
 * partial expectation must never silently degrade into an unowned request.
 */
export function parseExpectedPersonalization(
  searchParams: URLSearchParams,
): PersonalizationSnapshot | null {
  return parseExpectedPersonalizationPair(
    searchParams.get('expected_profile_id'),
    searchParams.get('expected_personalization_updated_at'),
  );
}

/**
 * Mutations carry the same optional ownership pair in their JSON body. Keeping
 * query and body parsing behind one validator prevents one surface from
 * accepting partial, non-canonical, or unsafe revisions that another rejects.
 */
export function parseExpectedPersonalizationBody(
  body: Record<string, unknown>,
): PersonalizationSnapshot | null {
  const hasProfile = body.expected_profile_id !== undefined;
  const hasUpdatedAt = body.expected_personalization_updated_at !== undefined;
  if (!hasProfile && !hasUpdatedAt) return null;
  if (!hasProfile || !hasUpdatedAt
    || typeof body.expected_profile_id !== 'string'
    || (typeof body.expected_personalization_updated_at !== 'string'
      && typeof body.expected_personalization_updated_at !== 'number')) {
    throw new CatalogError(400, 'profile expectation requires profile id and personalization revision');
  }
  return parseExpectedPersonalizationPair(
    body.expected_profile_id,
    String(body.expected_personalization_updated_at),
  );
}

function parseExpectedPersonalizationPair(
  profileInput: string | null,
  updatedAtInput: string | null,
): PersonalizationSnapshot | null {
  if (profileInput === null && updatedAtInput === null) return null;
  if (profileInput === null || updatedAtInput === null) {
    throw new CatalogError(400, 'profile expectation requires profile id and personalization revision');
  }
  const activeProfileId = profileInput.trim().toLowerCase();
  const updatedAt = Number(updatedAtInput);
  if (!activeProfileId || activeProfileId.length > 32
    || !/^(0|[1-9]\d*)$/.test(updatedAtInput)
    || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new CatalogError(400, 'invalid profile expectation');
  }
  return {
    active_profile_id: activeProfileId,
    updated_at: updatedAt,
  };
}

export function assertExpectedPersonalization(
  expected: PersonalizationSnapshot | null | undefined,
  current: PersonalizationSnapshot,
  phase: string,
): void {
  if (!expected) return;
  if (expected.active_profile_id !== current.active_profile_id
    || expected.updated_at !== current.updated_at) {
    throw new CatalogError(409, `profile changed ${phase}`, undefined, {
      couchMessage: 'profile changed — refreshing',
    });
  }
}

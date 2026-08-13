import { CatalogError } from '../catalog-errors.js';

export type RecommendationAttributionRequestFields = {
  attribution_token?: unknown;
  slate_revision?: unknown;
  recommendation_item_type?: unknown;
  recommendation_item_id?: unknown;
};

export type RecommendationItemIdentity = {
  type?: unknown;
  id?: unknown;
};

/**
 * `rail_id` is display context on ordinary catalog/Search cards, not proof.
 * `recommendation_item_type` / `recommendation_item_id` identify the card once
 * a slate is present; they must not opt Search or unattributed YouTube play
 * into served-slate validation. Token or served revision is the opt-in, matching
 * mutation attribution.
 */
export function hasRecommendationAttributionIntent(
  input: RecommendationAttributionRequestFields,
): boolean {
  return input.attribution_token !== undefined
    || input.slate_revision !== undefined;
}

/**
 * Bind the served recommendation card to the content that will actually play.
 * A series card is allowed to resolve to one of its episodes, but a merely
 * prefix-related title is never the same recommendation.
 */
export function isRecommendationPlaybackIdentityCompatible(
  served: RecommendationItemIdentity,
  playback: RecommendationItemIdentity,
): boolean {
  if (typeof served.type !== 'string' || typeof served.id !== 'string'
    || typeof playback.type !== 'string' || typeof playback.id !== 'string') {
    return false;
  }
  if (!served.type || !served.id || served.type !== playback.type) return false;
  if (served.id === playback.id) return true;
  if (served.type !== 'series' || !playback.id.startsWith(`${served.id}:`)) return false;
  const episodeSuffix = playback.id.slice(served.id.length + 1);
  return /^\d+:\d+$/.test(episodeSuffix);
}

/**
 * Explicit Play of a visible card is user intent. A missing, expired, or
 * incomplete served slate must not block mpv. Mutations stay fail-closed.
 * Real profile fences (`expected_profile_id`) are asserted separately.
 */
export function acceptPlaybackRecommendationAttribution<T>(resolve: () => T): T | null {
  try {
    return resolve();
  } catch (error) {
    if (error instanceof CatalogError && error.status === 409) {
      return null;
    }
    throw error;
  }
}

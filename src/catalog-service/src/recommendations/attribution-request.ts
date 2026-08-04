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
 * `rail_id` is intentionally absent: ordinary catalog playback has carried it
 * since before recommendation attribution existed. Presence (including an
 * empty or otherwise invalid value) of any recommendation-only field opts the
 * request into strict served-slate validation.
 */
export function hasRecommendationAttributionIntent(
  input: RecommendationAttributionRequestFields,
): boolean {
  return input.attribution_token !== undefined
    || input.slate_revision !== undefined
    || input.recommendation_item_type !== undefined
    || input.recommendation_item_id !== undefined;
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

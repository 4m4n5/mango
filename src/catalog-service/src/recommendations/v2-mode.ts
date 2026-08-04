export type RecommendationV2Mode = 'off' | 'shadow' | 'serve';

export function vodRecommendationsV2Mode(
  raw = process.env.MANGO_VOD_RECS_V2,
): RecommendationV2Mode {
  const normalized = raw?.trim().toLowerCase();
  return normalized === 'shadow' || normalized === 'serve' ? normalized : 'off';
}

export function vodRecommendationsHouseholdOnly(raw = process.env.MANGO_VOD_RECS_V2): boolean {
  return vodRecommendationsV2Mode(raw) === 'serve';
}

/**
 * Profile/mood ownership belongs to the VOD rollout boundary. YouTube v2 has
 * its own household-scoped ranking inputs, but enabling it must not mutate the
 * active VOD profile or hide the global personalization controls while VOD v2
 * remains off/shadow.
 *
 * Keep the YouTube argument explicit so mixed-mode behavior is intentional and
 * exhaustively testable rather than an accidental consequence of call sites.
 */
export function recommendationsHouseholdOnlyForRollout(
  vodRaw = process.env.MANGO_VOD_RECS_V2,
  youtubeRaw = process.env.MANGO_YOUTUBE_RECS_V2,
): boolean {
  void youtubeRaw;
  return vodRecommendationsHouseholdOnly(vodRaw);
}

/**
 * Resolve the immutable owner used by a domain's served-slate tokens and watch
 * events. This is deliberately separate from the global personalization UI:
 * YouTube v2 can use Household signals while a personal profile remains active
 * for legacy/shadow VOD.
 */
export function recommendationOwnerForRollout(
  domain: 'vod' | 'youtube',
  activeProfileId: string,
  vodRaw = process.env.MANGO_VOD_RECS_V2,
  youtubeRaw = process.env.MANGO_YOUTUBE_RECS_V2,
): string {
  const domainServesHousehold = domain === 'vod'
    ? vodRecommendationsHouseholdOnly(vodRaw)
    : youtubeRaw?.trim().toLowerCase() === 'serve';
  return domainServesHousehold ? 'household' : activeProfileId;
}

export type RecommendationV2Mode = 'off' | 'shadow' | 'serve';

export function vodRecommendationsV2Mode(
  raw = process.env.MANGO_VOD_RECS_V2,
): RecommendationV2Mode {
  const normalized = raw?.trim().toLowerCase();
  return normalized === 'shadow' || normalized === 'serve' ? normalized : 'off';
}

export function vodRecommendationsHouseholdOnly(raw = process.env.MANGO_VOD_RECS_V2): boolean {
  return vodRecommendationsV2Mode(raw) !== 'off';
}

/**
 * Profile/mood rows remain durable, but the latest recommendation architecture
 * is Household-only in both shadow and serve. Shadow changes visibility, not
 * rank identity.
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
 * YouTube v2 can use Household signals while personal profile rows remain
 * dormant and recoverable.
 */
export function recommendationOwnerForRollout(
  domain: 'vod' | 'youtube',
  activeProfileId: string,
  vodRaw = process.env.MANGO_VOD_RECS_V2,
  youtubeRaw = process.env.MANGO_YOUTUBE_RECS_V2,
): string {
  const domainServesHousehold = domain === 'vod'
    ? vodRecommendationsHouseholdOnly(vodRaw)
    : ['shadow', 'serve'].includes(youtubeRaw?.trim().toLowerCase() ?? '');
  return domainServesHousehold ? 'household' : activeProfileId;
}

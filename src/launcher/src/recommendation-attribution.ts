import type { ContentCard } from './types';

export type RecommendationAttributionPayload = {
  attribution_token?: string;
  rail_id?: string;
  slate_revision?: number;
};

/**
 * Ordinary cards have a rail id too, so rail id alone must not opt a mutation
 * into recommendation validation. Once a token or served revision is present,
 * propagate every available proof field and let the service fail closed if the
 * card is incomplete or stale.
 */
export function recommendationAttributionPayload(
  card: Pick<ContentCard, 'attributionToken' | 'railId' | 'slateSequence'>,
): RecommendationAttributionPayload {
  if (card.attributionToken === undefined && card.slateSequence === undefined) return {};
  const payload: RecommendationAttributionPayload = {};
  if (card.attributionToken !== undefined) payload.attribution_token = card.attributionToken;
  if (card.railId !== undefined) payload.rail_id = card.railId;
  if (card.slateSequence !== undefined) payload.slate_revision = card.slateSequence;
  return payload;
}

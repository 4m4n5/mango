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

export type PlaybackRecommendationFields = RecommendationAttributionPayload & {
  recommendation_item_type?: string;
  recommendation_item_id?: string;
};

/**
 * Play may carry a display rail id without claiming a served slate. Item
 * identity is proof's companion, not an opt-in: Search and History without a
 * token must play as ordinary YouTube, not as a recommendation watch.
 */
export function playbackRecommendationFields(
  card: Pick<ContentCard, 'attributionToken' | 'railId' | 'slateSequence' | 'type' | 'id'>,
): PlaybackRecommendationFields {
  const fields: PlaybackRecommendationFields = {};
  if (card.railId) fields.rail_id = card.railId;
  if (Number.isInteger(card.slateSequence)) fields.slate_revision = card.slateSequence;
  if (card.attributionToken) {
    fields.attribution_token = card.attributionToken;
    fields.recommendation_item_type = card.type;
    fields.recommendation_item_id = card.id;
  }
  return fields;
}

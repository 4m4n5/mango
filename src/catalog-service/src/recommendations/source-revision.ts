import { libraryDatabase, type RecommendationServedSlate } from '../library/db.js';
import { vodRecommendationsV2Mode } from './v2-mode.js';

export function isCurrentVodRecommendationSource(served: RecommendationServedSlate): boolean {
  if (served.domain !== 'vod') return true;
  const tab = served.rail_id === 'for-you-movies'
    ? 'movies'
    : served.rail_id === 'for-you-series' ? 'series' : null;
  if (!tab) return true;
  const contentType = tab === 'movies' ? 'movie' : 'series';
  const db = libraryDatabase();
  if (vodRecommendationsV2Mode() === 'off') return false;
  const row = db.prepare(`
SELECT active_rank_generation_id
FROM vod_active_generations
WHERE content_type = ?
`).get(contentType) as { active_rank_generation_id: number | null } | undefined;
  return row?.active_rank_generation_id !== null
    && row?.active_rank_generation_id !== undefined
    && served.source_revision === row.active_rank_generation_id;
}

export function assertCurrentVodRecommendationSource(served: RecommendationServedSlate): void {
  if (!isCurrentVodRecommendationSource(served)) {
    throw new Error('recommendation source revision is stale');
  }
}

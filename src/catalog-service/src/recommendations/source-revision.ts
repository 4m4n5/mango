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
  if (vodRecommendationsV2Mode() === 'serve') {
    const row = db.prepare(`
SELECT active_rank_generation_id
FROM vod_active_generations
WHERE content_type = ?
`).get(contentType) as { active_rank_generation_id: number | null } | undefined;
    if (row?.active_rank_generation_id !== null && row?.active_rank_generation_id !== undefined) {
      return served.source_revision === row.active_rank_generation_id;
    }
  }
  const legacy = db.prepare(`
SELECT MAX(revision) AS revision
FROM profile_recommendation_snapshots
WHERE profile_id = ? AND tab = ?
`).get(served.profile_id, tab) as { revision: number | null };
  return legacy.revision === null || served.source_revision === legacy.revision;
}

export function assertCurrentVodRecommendationSource(served: RecommendationServedSlate): void {
  if (!isCurrentVodRecommendationSource(served)) {
    throw new Error('recommendation source revision is stale');
  }
}

import { libraryDatabase } from '../library/db.js';
import { listRatings } from '../library/ratings.js';
import { KeyedSerialExecutor } from './background-refresh.js';
import { listRecommendationRefreshJobs, type RecommendationRefreshJob } from './jobs.js';
import { vodRecommendationsV2Mode } from './v2-mode.js';
import {
  hasPublishedStoryGraphGeneration,
  loadStoryGraphForYouRail,
  refreshStoryGraphForYou,
  storyGraphDiagnostics,
  storyGraphPublishedHasNoTaste,
  storyGraphPromotionEligible,
  storyGraphServingWorkSnapshot,
  type StoryGraphForYouRail,
} from './story-graph-service.js';

export type ForYouTab = 'movies' | 'series';
export type ForYouRail = StoryGraphForYouRail;

export type RefreshForYouResult = {
  tab: ForYouTab;
  revision: number;
  candidate_count: number;
  item_count: number;
  published: boolean;
  activated: boolean;
};

export function fireWaterRatingsEnabled(): boolean {
  return process.env.MANGO_FIRE_WATER_RATINGS !== '0';
}

export function forYouEnabled(): boolean {
  return process.env.MANGO_FOR_YOU !== '0';
}

function normalizedMetricProfileId(profileId: string): string {
  const normalized = profileId.trim().toLowerCase();
  if (!normalized) throw new Error('recommendation metric owner is empty');
  return normalized;
}

/**
 * Operational counters remain profile-keyed for schema compatibility. New VOD
 * recommendation work always writes Household; historical personal rows are
 * preserved but never read as ranking input.
 */
export function incrementRecommendationMetric(name: string, profileId = 'household'): void {
  const metricName = name.trim();
  if (!metricName) throw new Error('recommendation metric name is empty');
  libraryDatabase().prepare(`
INSERT INTO profile_recommendation_metrics(profile_id, metric_name, metric_value, updated_at)
VALUES (?, ?, 1, ?)
ON CONFLICT(profile_id, metric_name) DO UPDATE SET
  metric_value = profile_recommendation_metrics.metric_value + 1,
  updated_at = excluded.updated_at
`).run(normalizedMetricProfileId(profileId), metricName, Date.now());
}

const refreshExecutor = new KeyedSerialExecutor<ForYouTab>();

/**
 * Refreshes only the progressive Story Frontier architecture. `shadow` still
 * builds it without exposing it; `off` is an explicit operational pause and
 * does not revive the removed v4 ranker.
 */
export function refreshForYou(
  tab: ForYouTab,
  options: { profile_id?: string; trigger_reasons?: readonly string[] } = {},
): Promise<RefreshForYouResult> {
  return refreshExecutor.run(tab, async () => {
    const mode = vodRecommendationsV2Mode();
    if (mode === 'off') {
      return {
        tab,
        revision: currentRecommendationRevision(tab),
        candidate_count: 0,
        item_count: 0,
        published: false,
        activated: false,
      };
    }
    if (options.profile_id && options.profile_id !== 'household') {
      throw new Error('VOD recommendations are Household-only');
    }
    const result = await refreshStoryGraphForYou(tab, {
      trigger_reasons: options.trigger_reasons ?? ['refresh'],
    });
    return {
      tab,
      revision: result.rank_generation_id,
      candidate_count: result.verified_count,
      item_count: result.reserve_depth,
      published: result.published,
      activated: result.activated,
    };
  });
}

export function currentRecommendationRevision(tab: ForYouTab): number {
  const type = tab === 'movies' ? 'movie' : 'series';
  const row = libraryDatabase().prepare(`
SELECT active_rank_generation_id AS revision
FROM vod_active_generations
WHERE content_type = ?
`).get(type) as { revision: number | null } | undefined;
  return row?.revision ?? 0;
}

/** Couch reads and X are cache-only. Shadow/off intentionally expose no rail. */
export async function loadForYouRail(
  tab: ForYouTab,
  options: {
    reshuffle?: boolean;
    profileId?: string;
    personalizationUpdatedAt?: number;
  } = {},
): Promise<ForYouRail | null> {
  void options.personalizationUpdatedAt;
  if (!forYouEnabled() || vodRecommendationsV2Mode() !== 'serve') return null;
  if (options.profileId && options.profileId !== 'household') return null;
  if (!hasPublishedStoryGraphGeneration(tab) || storyGraphPublishedHasNoTaste(tab)) return null;
  if (!storyGraphPromotionEligible(tab)) return null;
  return loadStoryGraphForYouRail(tab, { reshuffle: options.reshuffle });
}

type AttributionRollup = {
  domain: 'vod' | 'youtube';
  rail_id: string;
  slate_revision: number;
  model_version: string | null;
  impressions: number;
  detail_opens: number;
  play_starts: number;
  completions_90pct: number;
  last_activity_at: number;
};

export function recommendationDiagnostics(): {
  enabled: boolean;
  recommendation_owner: 'household';
  ratings: number;
  metrics: Record<string, { value: number; updated_at: number }>;
  refresh_jobs: RecommendationRefreshJob[];
  vod_mode: ReturnType<typeof vodRecommendationsV2Mode>;
  story_frontier: ReturnType<typeof storyGraphDiagnostics>;
  serving_work: ReturnType<typeof storyGraphServingWorkSnapshot>;
  attribution_rollup: AttributionRollup[];
} {
  const db = libraryDatabase();
  const metricRows = db.prepare(`
SELECT metric_name, metric_value, updated_at
FROM profile_recommendation_metrics
WHERE profile_id = 'household'
ORDER BY metric_name
`).all() as Array<{ metric_name: string; metric_value: number; updated_at: number }>;
  const attributionRollup = db.prepare(`
WITH attribution_keys AS (
  SELECT profile_id, domain, rail_id, slate_revision
  FROM profile_recommendation_impressions
  WHERE profile_id = 'household'
  UNION
  SELECT profile_id, domain, rail_id, slate_revision
  FROM profile_recommendation_outcomes
  WHERE profile_id = 'household'
)
SELECT k.domain, k.rail_id, k.slate_revision, ranks.model_version,
       (SELECT COUNT(*) FROM profile_recommendation_impressions i
        WHERE i.profile_id = k.profile_id AND i.domain = k.domain
          AND i.rail_id = k.rail_id AND i.slate_revision = k.slate_revision) AS impressions,
       (SELECT COUNT(*) FROM profile_recommendation_outcomes o
        WHERE o.profile_id = k.profile_id AND o.domain = k.domain
          AND o.rail_id = k.rail_id AND o.slate_revision = k.slate_revision
          AND o.detail_opened_at IS NOT NULL) AS detail_opens,
       (SELECT COUNT(*) FROM profile_recommendation_outcomes o
        WHERE o.profile_id = k.profile_id AND o.domain = k.domain
          AND o.rail_id = k.rail_id AND o.slate_revision = k.slate_revision
          AND o.play_started_at IS NOT NULL) AS play_starts,
       (SELECT COUNT(*) FROM profile_recommendation_outcomes o
        WHERE o.profile_id = k.profile_id AND o.domain = k.domain
          AND o.rail_id = k.rail_id AND o.slate_revision = k.slate_revision
          AND o.max_progress_pct >= 0.9) AS completions_90pct,
       MAX(
         COALESCE((SELECT MAX(i.shown_at) FROM profile_recommendation_impressions i
                   WHERE i.profile_id = k.profile_id AND i.domain = k.domain
                     AND i.rail_id = k.rail_id AND i.slate_revision = k.slate_revision), 0),
         COALESCE((SELECT MAX(o.updated_at) FROM profile_recommendation_outcomes o
                   WHERE o.profile_id = k.profile_id AND o.domain = k.domain
                     AND o.rail_id = k.rail_id AND o.slate_revision = k.slate_revision), 0)
       ) AS last_activity_at
FROM attribution_keys k
LEFT JOIN profile_recommendation_served_slates served
  ON served.profile_id = k.profile_id
 AND served.domain = k.domain
 AND served.rail_id = k.rail_id
 AND served.slate_revision = k.slate_revision
LEFT JOIN vod_rank_generations ranks
  ON k.domain = 'vod' AND ranks.rank_generation_id = served.source_revision
ORDER BY last_activity_at DESC, k.domain, k.rail_id, k.slate_revision DESC
LIMIT 40
`).all() as AttributionRollup[];
  return {
    enabled: forYouEnabled(),
    recommendation_owner: 'household',
    ratings: listRatings(undefined, 'household').length,
    metrics: Object.fromEntries(metricRows.map((row) => [
      row.metric_name,
      { value: row.metric_value, updated_at: row.updated_at },
    ])),
    refresh_jobs: listRecommendationRefreshJobs(20),
    vod_mode: vodRecommendationsV2Mode(),
    story_frontier: storyGraphDiagnostics(),
    serving_work: storyGraphServingWorkSnapshot(),
    attribution_rollup: attributionRollup,
  };
}

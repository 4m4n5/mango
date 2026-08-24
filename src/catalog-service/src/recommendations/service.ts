import { activeViewerProfileId, libraryDatabase } from '../library/db.js';
import { listRatings } from '../library/ratings.js';
import { KeyedSerialExecutor } from './background-refresh.js';
import { listRecommendationRefreshJobs, type RecommendationRefreshJob } from './jobs.js';
import { recommendationOwnerForRollout, vodRecommendationsV2Mode } from './v2-mode.js';
import {
  hasPublishedStoryGraphGeneration,
  loadStoryGraphForYouRail,
  refreshStoryGraphForYou,
  storyGraphDiagnostics,
  storyGraphPublishedHasNoTaste,
  storyGraphServeAuthorized,
  storyGraphServingWorkSnapshot,
  type StoryGraphForYouRail,
} from './story-graph-service.js';
import { buildColdStartTopPicksSlate } from './activation-gates.js';
import { desiredRevisionDiagnostics } from './desired-revision.js';
import { listVerifiedRecommendationCatalogPage } from '../playability/db.js';
import {
  VOD_BROWSE_MODEL_VERSION,
  VOD_RELATED_MODEL_VERSION,
  vodBrowseV3Mode,
} from './vod-browse-v3.js';

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
  options: {
    profile_id?: string;
    trigger_reasons?: readonly string[];
    job_ids?: readonly string[];
  } = {},
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
      job_ids: options.job_ids,
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

/**
 * Couch reads and X are cache-only. Shadow/off intentionally expose no rail.
 *
 * Truthful Top Picks fallback contract: when For You is enabled and the mode
 * is `serve`, the couch is never handed an empty For You slot. Any of the
 * following states falls back to a labelled Top Picks rail drawn
 * deterministically from the verified corpus:
 *   - no personalized generation published yet
 *   - the published generation has no taste (empty state)
 *   - serving is unauthorized for the household (gen present but not
 *     yet serve-authorized, or auth was withdrawn)
 * The rail is labelled "Top Picks", never "For You", so the couch is not
 * misled into believing this is a personalized ranking. `shadow`/`off`
 * modes and non-household profile calls still return `null` — those are
 * explicit operational states where no rail should render.
 */
export async function loadForYouRail(
  tab: ForYouTab,
  options: {
    reshuffle?: boolean;
    profileId?: string;
    personalizationUpdatedAt?: number;
    excludeKeys?: ReadonlySet<string>;
    persist?: boolean;
  } = {},
): Promise<ForYouRail | null> {
  void options.personalizationUpdatedAt;
  if (!forYouEnabled() || vodRecommendationsV2Mode() !== 'serve') return null;
  if (options.profileId && options.profileId !== 'household') return null;
  const noPersonalized = !hasPublishedStoryGraphGeneration(tab) || storyGraphPublishedHasNoTaste(tab);
  const unauthorized = !storyGraphServeAuthorized(tab);
  if (noPersonalized || unauthorized) {
    return truthfulTopPicksRail(tab, options.excludeKeys ?? new Set());
  }
  return loadStoryGraphForYouRail(tab, {
    reshuffle: options.reshuffle,
    exclude_keys: options.excludeKeys,
    persist: options.persist,
  });
}

/**
 * Bounded cached snapshot of the verified catalog scan used by
 * `truthfulTopPicksRail`. Keyed by `(tab, corpus revision)` so:
 *   - every serve-time invalidation is O(1): a new corpus generation blows
 *     the cache automatically when its revision key changes,
 *   - a short TTL bounds staleness for corpora that update without a
 *     rank-generation bump,
 *   - the couch does not pay a 600-row DB scan on every rail load.
 * The cache is a single-slot-per-tab bounded snapshot; there is no
 * unbounded map growth.
 */
type TopPicksSnapshot = {
  key: string;
  refreshed_at: number;
  collected: Array<{ id: string; title: string; poster: string; year?: string }>;
};
const TOP_PICKS_CACHE = new Map<ForYouTab, TopPicksSnapshot>();
const TOP_PICKS_CACHE_TTL_MS = 60_000;

function topPicksRevisionKey(tab: ForYouTab): string {
  const contentType = tab === 'movies' ? 'movie' : 'series';
  const row = libraryDatabase().prepare(`
SELECT active_rank_generation_id AS rank_gen, previous_complete_rank_generation_id AS prev_gen
FROM vod_active_generations WHERE content_type = ?
`).get(contentType) as { rank_gen: number | null; prev_gen: number | null } | undefined;
  const latest = libraryDatabase().prepare(`
SELECT rank_generation_id AS gen, corpus_generation AS corpus
FROM vod_rank_generations WHERE content_type = ?
ORDER BY rank_generation_id DESC LIMIT 1
`).get(contentType) as { gen: number | null; corpus: number | null } | undefined;
  return `${row?.rank_gen ?? 'null'}:${row?.prev_gen ?? 'null'}:${latest?.gen ?? 'null'}:${latest?.corpus ?? 'null'}`;
}

/**
 * Deterministic Top Picks fallback rail. Ordered by (title asc, id asc) so two
 * independent processes render the same slate for the same corpus. Uses the
 * pure `buildColdStartTopPicksSlate` helper for the ordering to keep the
 * decision auditable and shared with the activation-gate module.
 */
async function truthfulTopPicksRail(
  tab: ForYouTab,
  excludeKeys: ReadonlySet<string>,
): Promise<ForYouRail | null> {
  const contentType = tab === 'movies' ? 'movie' : 'series';
  const started = Date.now();
  const revisionKey = topPicksRevisionKey(tab);
  const cached = TOP_PICKS_CACHE.get(tab);
  let collected: Array<{ id: string; title: string; poster: string; year?: string }>;
  if (cached && cached.key === revisionKey && started - cached.refreshed_at < TOP_PICKS_CACHE_TTL_MS) {
    collected = cached.collected;
  } else {
    let cursor: string | null = null;
    const scanned: Array<{ id: string; title: string; poster: string; year?: string }> = [];
    // Bound at ~600 verified titles for the fallback; more than enough to
    // fill a six-card rail with exclusions and cache reuse.
    const MAX_CATALOG_SCAN = 600;
    while (scanned.length < MAX_CATALOG_SCAN) {
      const page: Awaited<ReturnType<typeof listVerifiedRecommendationCatalogPage>> =
        await listVerifiedRecommendationCatalogPage({
          content_type: contentType,
          cursor,
          limit: 200,
        });
      for (const row of page.items) {
        scanned.push({
          id: row.id,
          title: row.title ?? row.id,
          poster: row.poster ?? '',
          ...(row.year ? { year: row.year } : {}),
        });
      }
      if (!page.next_cursor || scanned.length >= page.verified_count) break;
      cursor = page.next_cursor;
    }
    collected = scanned;
    TOP_PICKS_CACHE.set(tab, { key: revisionKey, refreshed_at: started, collected: scanned });
  }
  if (collected.length === 0) return null;
  const slate = buildColdStartTopPicksSlate({
    tab,
    verified_titles: collected,
    limit: 6,
    exclude: new Set([...excludeKeys].map((key) => key.split(':').pop() ?? key)),
  });
  if (slate.items.length === 0) return null;
  return {
    rail_id: slate.rail_id,
    label: 'Top Picks',
    slate_sequence: 0,
    attribution_token: `cold-start-top-picks:${contentType}`,
    items: slate.items.map((item) => ({
      id: item.id,
      type: contentType,
      title: item.title,
      subtitle: 'Top Picks',
      poster: item.poster,
      ...(item.year ? { year: item.year } : {}),
      source: item.source,
    })),
    resolve_ms: Date.now() - started,
    skipped: 0,
    cached: true,
    playability: {
      displayed: slate.items.length,
      verified_pool: collected.length,
      pending: 0,
      low_water: false,
      session_id: `cold-start:${contentType}:${started}`,
    },
  };
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
  recommendation_owner: string;
  ratings: number;
  metrics: Record<string, { value: number; updated_at: number }>;
  refresh_jobs: RecommendationRefreshJob[];
  vod_mode: ReturnType<typeof vodRecommendationsV2Mode>;
  browse_v3: {
    mode: ReturnType<typeof vodBrowseV3Mode>;
    browse_model_version: typeof VOD_BROWSE_MODEL_VERSION;
    related_model_version: typeof VOD_RELATED_MODEL_VERSION;
  };
  story_frontier: ReturnType<typeof storyGraphDiagnostics>;
  serving_work: ReturnType<typeof storyGraphServingWorkSnapshot>;
  attribution_rollup: AttributionRollup[];
  desired_revision_diagnostics: ReturnType<typeof desiredRevisionDiagnostics>;
} {
  const db = libraryDatabase();
  const vodMode = vodRecommendationsV2Mode();
  const recommendationOwner = recommendationOwnerForRollout(
    'vod',
    activeViewerProfileId(),
    vodMode,
    process.env.MANGO_YOUTUBE_RECS_V2,
  );
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
    recommendation_owner: recommendationOwner,
    ratings: listRatings(undefined, recommendationOwner).length,
    metrics: Object.fromEntries(metricRows.map((row) => [
      row.metric_name,
      { value: row.metric_value, updated_at: row.updated_at },
    ])),
    refresh_jobs: listRecommendationRefreshJobs(20),
    vod_mode: vodMode,
    browse_v3: {
      mode: vodBrowseV3Mode(),
      browse_model_version: VOD_BROWSE_MODEL_VERSION,
      related_model_version: VOD_RELATED_MODEL_VERSION,
    },
    story_frontier: storyGraphDiagnostics(),
    serving_work: storyGraphServingWorkSnapshot(),
    attribution_rollup: attributionRollup,
    // Diagnostic-only view of the durable desired-revision table. Included in
    // the /rec/state facade so operators and tests can verify the worker CLI
    // has picked up and acknowledged the latest desired revision without
    // relying on in-catalog rank flights.
    desired_revision_diagnostics: safeDesiredRevisionDiagnostics(),
  };
}

function safeDesiredRevisionDiagnostics(): ReturnType<typeof desiredRevisionDiagnostics> {
  try {
    return desiredRevisionDiagnostics();
  } catch {
    return [];
  }
}

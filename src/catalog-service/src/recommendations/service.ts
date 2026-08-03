import { createHash } from 'node:crypto';
import {
  libraryDatabase,
  listRecommendationLibrarySignals,
  type RecommendationLibrarySignal,
} from '../library/db.js';
import { listRatings, type RatingContentType } from '../library/ratings.js';
import { listVerifiedLibraryCatalogRows } from '../playability/db.js';
import {
  RECOMMENDATION_FEATURE_VERSION,
  RECOMMENDATION_MODEL_VERSION,
  buildRecommendationFeature,
  candidatesToFeatures,
  rankRecommendations,
  recommendationDailySeed,
  type RecommendationFeature,
  type ScoredRecommendation,
} from './engine.js';

export type ForYouTab = 'movies' | 'series';

export type ForYouRail = {
  rail_id: 'for-you-movies' | 'for-you-series';
  label: 'For You';
  items: Array<{
    id: string;
    type: RatingContentType;
    title: string;
    subtitle: string;
    poster: string;
    year?: string;
    source: string;
  }>;
  resolve_ms: number;
  skipped: number;
  cached?: boolean;
  playability: {
    displayed: number;
    verified_pool: number;
    pending: number;
    low_water: boolean;
    session_id: string;
  };
};

type SnapshotItemRow = {
  revision: number;
  rank: number;
  content_type: RatingContentType;
  content_id: string;
  title: string;
  poster: string | null;
  year: string | null;
};

export function fireWaterRatingsEnabled(): boolean {
  return process.env.MANGO_FIRE_WATER_RATINGS !== '0';
}

export function forYouEnabled(): boolean {
  return process.env.MANGO_FOR_YOU !== '0';
}

export function recommendationAiEnabled(): boolean {
  return process.env.MANGO_RECOMMENDATIONS_AI !== '0';
}

export function setRecommendationMetric(name: string, value: number): void {
  libraryDatabase().prepare(`
INSERT INTO recommendation_metrics(metric_name, metric_value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(metric_name) DO UPDATE SET
  metric_value = excluded.metric_value,
  updated_at = excluded.updated_at
`).run(name, Math.max(0, Math.round(value)), Date.now());
}

export function incrementRecommendationMetric(name: string): void {
  libraryDatabase().prepare(`
INSERT INTO recommendation_metrics(metric_name, metric_value, updated_at)
VALUES (?, 1, ?)
ON CONFLICT(metric_name) DO UPDATE SET
  metric_value = recommendation_metrics.metric_value + 1,
  updated_at = excluded.updated_at
`).run(name, Date.now());
}

function contentTypeForTab(tab: ForYouTab): RatingContentType {
  return tab === 'movies' ? 'movie' : 'series';
}

function featureMetadataHash(feature: RecommendationFeature): string {
  return createHash('sha256')
    .update(JSON.stringify({
      type: feature.type,
      id: feature.id,
      title: feature.title,
      year: feature.year,
      rail_id: feature.rail_id,
    }))
    .digest('hex');
}

function persistFeature(feature: RecommendationFeature, timestamp: number): void {
  libraryDatabase().prepare(`
INSERT INTO recommendation_features (
  content_type, content_id, feature_version, metadata_hash, provenance, confidence,
  features_json, model_version, created_at, updated_at
) VALUES (?, ?, ?, ?, 'metadata', ?, ?, ?, ?, ?)
ON CONFLICT(content_type, content_id, feature_version) DO UPDATE SET
  metadata_hash = excluded.metadata_hash,
  provenance = excluded.provenance,
  confidence = excluded.confidence,
  features_json = excluded.features_json,
  model_version = excluded.model_version,
  updated_at = excluded.updated_at
`).run(
    feature.type,
    feature.id,
    RECOMMENDATION_FEATURE_VERSION,
    featureMetadataHash(feature),
    feature.confidence,
    JSON.stringify({ vector: feature.vector, cluster: feature.cluster, rail_id: feature.rail_id }),
    RECOMMENDATION_MODEL_VERSION,
    timestamp,
    timestamp,
  );
}

function nextSnapshotRevision(tab: ForYouTab): number {
  const row = libraryDatabase().prepare(`
SELECT COALESCE(MAX(revision), 0) + 1 AS revision
FROM recommendation_snapshots WHERE tab = ?
`).get(tab) as { revision: number };
  return row.revision;
}

function publishSnapshot(
  tab: ForYouTab,
  ranked: ScoredRecommendation[],
  posterByKey: Map<string, string | null>,
  candidateCount: number,
  dailySeed: string,
): number {
  const db = libraryDatabase();
  const revision = nextSnapshotRevision(tab);
  const timestamp = Date.now();
  db.transaction(() => {
    db.prepare(`
INSERT INTO recommendation_snapshots (
  tab, revision, model_version, model_kind, status, candidate_count, generated_at, daily_seed
) VALUES (?, ?, ?, 'knn-shrinkage', 'ready', ?, ?, ?)
`).run(tab, revision, RECOMMENDATION_MODEL_VERSION, candidateCount, timestamp, dailySeed);
    const insert = db.prepare(`
INSERT INTO recommendation_snapshot_items (
  tab, revision, rank, content_type, content_id, title, poster, year, bucket,
  affinity, diversity, predicted_fire, predicted_water, generation_reason
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    ranked.forEach((item, index) => insert.run(
      tab,
      revision,
      index + 1,
      item.type,
      item.id,
      item.title,
      posterByKey.get(`${item.type}:${item.id}`) ?? null,
      item.year,
      item.bucket,
      item.affinity,
      item.diversity,
      item.predicted_fire,
      item.predicted_water,
      item.bucket === 'explore' ? 'stable_daily_exploration' : 'dual_axis_affinity',
    ));
    db.prepare(`
DELETE FROM recommendation_snapshots
WHERE tab = ? AND revision NOT IN (
  SELECT revision FROM recommendation_snapshots WHERE tab = ? ORDER BY revision DESC LIMIT 8
)
`).run(tab, tab);
  })();
  return revision;
}

export async function refreshForYou(tab: ForYouTab): Promise<{
  tab: ForYouTab;
  revision: number;
  candidate_count: number;
  item_count: number;
}> {
  const startedAt = Date.now();
  const type = contentTypeForTab(tab);
  const [verified, ratings] = await Promise.all([
    listVerifiedLibraryCatalogRows(1200),
    Promise.resolve(listRatings()),
  ]);
  if (ratings.length === 0) throw new Error('For You requires at least one explicit Fire/Water rating');
  const ratedKeys = new Set(ratings.map((rating) => `${rating.type}:${rating.id}`));
  const signals = new Map<string, RecommendationLibrarySignal>(listRecommendationLibrarySignals()
    .map((signal) => [`${signal.type}:${signal.id}`, signal] as const));
  const preferred: typeof verified = [];
  const fallback: typeof verified = [];
  let excludedRated = 0;
  let excludedHard = 0;
  for (const candidate of verified) {
    if (candidate.type !== type) continue;
    const key = `${candidate.type}:${candidate.id}`;
    if (ratedKeys.has(key)) {
      excludedRated += 1;
      continue;
    }
    const signal = signals.get(key);
    if (signal?.hidden || signal?.blocked || signal?.not_interested) {
      excludedHard += 1;
      continue;
    }
    if (signal?.saved || signal?.started || signal?.completed) fallback.push(candidate);
    else preferred.push(candidate);
  }
  const candidates = preferred.length >= 6 ? preferred : [...preferred, ...fallback];
  const features = candidatesToFeatures(candidates, type);
  const ratingFeatures = new Map<string, RecommendationFeature>();
  for (const rating of ratings) {
    ratingFeatures.set(`${rating.type}:${rating.id}`, buildRecommendationFeature({
      type: rating.type,
      id: rating.id,
      title: rating.title,
      year: rating.year,
    }));
  }
  const timestamp = Date.now();
  for (const feature of [...features, ...ratingFeatures.values()]) persistFeature(feature, timestamp);
  const dailySeed = recommendationDailySeed(tab);
  // Persist a deeper last-good reserve than the 12 cards sent to the launcher.
  // Eligibility can change between nightly runs (rating, hide, block), so the
  // loader needs enough already-ranked playable candidates to heal the rail
  // without putting generation on the couch-critical path.
  const ranked = rankRecommendations({
    tab,
    candidates: features,
    ratings,
    ratingFeatures,
    dailySeed,
    limit: 40,
  });
  if (ranked.length < 6) throw new Error(`For You ${tab} requires at least six eligible playable titles`);
  const posterByKey = new Map<string, string | null>(candidates.map((candidate) => [
    `${candidate.type}:${candidate.id}`,
    candidate.poster,
  ]));
  const revision = publishSnapshot(tab, ranked, posterByKey, candidates.length, dailySeed);
  setRecommendationMetric(`generation_duration_ms_last_${tab}`, Date.now() - startedAt);
  setRecommendationMetric(`candidate_count_last_${tab}`, candidates.length);
  setRecommendationMetric(`excluded_rated_last_${tab}`, excludedRated);
  setRecommendationMetric(`excluded_hard_last_${tab}`, excludedHard);
  setRecommendationMetric(`feature_metadata_last_${tab}`, features.length);
  setRecommendationMetric(`feature_ai_last_${tab}`, 0);
  setRecommendationMetric(`ai_fallback_last_${tab}`, recommendationAiEnabled() ? 1 : 0);
  return { tab, revision, candidate_count: candidates.length, item_count: ranked.length };
}

export async function refreshAllForYou(): Promise<Array<Awaited<ReturnType<typeof refreshForYou>>>> {
  const results = [];
  for (const tab of ['movies', 'series'] as const) results.push(await refreshForYou(tab));
  return results;
}

export function currentRecommendationRevision(tab: ForYouTab): number {
  const row = libraryDatabase().prepare(`
SELECT COALESCE(MAX(revision), 0) AS revision FROM recommendation_snapshots WHERE tab = ?
`).get(tab) as { revision: number };
  return row.revision;
}

export function loadForYouRail(tab: ForYouTab): ForYouRail | null {
  if (!forYouEnabled()) return null;
  const rows = libraryDatabase().prepare(`
SELECT rsi.revision, rsi.rank, rsi.content_type, rsi.content_id, rsi.title, rsi.poster, rsi.year
FROM recommendation_snapshot_items rsi
WHERE rsi.tab = ?
  AND rsi.revision = (SELECT MAX(revision) FROM recommendation_snapshots WHERE tab = ?)
ORDER BY rsi.rank ASC
LIMIT 40
`).all(tab, tab) as SnapshotItemRow[];
  if (rows.length < 6) return null;
  const ineligible = new Set(listRecommendationLibrarySignals()
    .filter((signal) => signal.hidden || signal.blocked || signal.not_interested)
    .map((signal) => `${signal.type}:${signal.id}`));
  const rated = new Set(listRatings().map((rating) => `${rating.type}:${rating.id}`));
  const eligible = rows.filter((row) => {
    const key = `${row.content_type}:${row.content_id}`;
    return !ineligible.has(key) && !rated.has(key);
  }).slice(0, 12);
  if (eligible.length < 6) return null;
  return {
    rail_id: tab === 'movies' ? 'for-you-movies' : 'for-you-series',
    label: 'For You',
    items: eligible.map((row) => ({
      id: row.content_id,
      type: row.content_type,
      title: row.title,
      subtitle: [row.content_type === 'movie' ? 'Movie' : 'TV Show', row.year].filter(Boolean).join(' · '),
      poster: row.poster ?? '',
      ...(row.year ? { year: row.year } : {}),
      source: 'for-you',
    })),
    resolve_ms: 0,
    skipped: rows.length - eligible.length,
    cached: true,
    playability: {
      displayed: eligible.length,
      verified_pool: eligible.length,
      pending: 0,
      low_water: false,
      session_id: `for-you-${rows[0]?.revision ?? 0}`,
    },
  };
}

export function recommendationDiagnostics(): {
  enabled: boolean;
  ai_enabled: boolean;
  ratings: number;
  tabs: Array<{ tab: ForYouTab; revision: number; generated_at: number | null; candidate_count: number }>;
  metrics: Record<string, { value: number; updated_at: number }>;
} {
  const ratings = listRatings().length;
  const rows = libraryDatabase().prepare(`
SELECT rs.tab, rs.revision, rs.generated_at, rs.candidate_count
FROM recommendation_snapshots rs
JOIN (
  SELECT tab, MAX(revision) AS revision FROM recommendation_snapshots GROUP BY tab
) latest ON latest.tab = rs.tab AND latest.revision = rs.revision
ORDER BY rs.tab
  `).all() as Array<{ tab: ForYouTab; revision: number; generated_at: number; candidate_count: number }>;
  const metricRows = libraryDatabase().prepare(`
SELECT metric_name, metric_value, updated_at FROM recommendation_metrics ORDER BY metric_name
`).all() as Array<{ metric_name: string; metric_value: number; updated_at: number }>;
  return {
    enabled: forYouEnabled(),
    ai_enabled: recommendationAiEnabled(),
    ratings,
    tabs: (['movies', 'series'] as const).map((tab) => {
      const row = rows.find((candidate) => candidate.tab === tab);
      return {
        tab,
        revision: row?.revision ?? 0,
        generated_at: row?.generated_at ?? null,
        candidate_count: row?.candidate_count ?? 0,
      };
    }),
    metrics: Object.fromEntries(metricRows.map((row) => [
      row.metric_name,
      { value: row.metric_value, updated_at: row.updated_at },
    ])),
  };
}

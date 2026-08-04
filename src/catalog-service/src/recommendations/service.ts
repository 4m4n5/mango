import { createHash } from 'node:crypto';
import {
  libraryDatabase,
  listRecommendationLibrarySignals,
  activeViewerProfileId,
  getPersonalizationState,
  listProfileLibraryFeedback,
  listProfileRecommendationSignals,
  listViewerProfiles,
  registerRecommendationServedSlate,
  type ProfileRecommendationSignal,
  type RecommendationLibrarySignal,
} from '../library/db.js';
import { listRatings, type FireWaterRating, type RatingContentType } from '../library/ratings.js';
import { getTitlesPlayabilityBulk, listVerifiedLibraryCatalogRows } from '../playability/db.js';
import {
  FOR_YOU_RESERVE_LIMIT,
  FOR_YOU_VISIBLE_LIMIT,
  RECOMMENDATION_FEATURE_VERSION,
  RECOMMENDATION_MODEL_VERSION,
  buildRecommendationFeature,
  recommendationDailySeed,
  type RecommendationFeature,
  type ImplicitRecommendationPreference,
  type NegativeRecommendationPreference,
  type ScoredRecommendation,
} from './engine.js';
import { rankRecommendationsOffThread } from './rank-worker-client.js';
import {
  buildAiEnrichedRecommendationFeature,
  loadAiRecommendationFeatures,
  refreshAiRecommendationFeatures,
  type RecommendationAiInput,
} from './ai.js';
import { evaluateExplicitRatings } from './evaluation.js';
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
} from './story-graph-service.js';

export type ForYouTab = 'movies' | 'series';

const VOD_REWATCH_COOLDOWN_MS = 180 * 24 * 60 * 60 * 1000;

export type ForYouRail = {
  rail_id: 'for-you-movies' | 'for-you-series';
  label: 'For You';
  slate_sequence: number;
  attribution_token: string;
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
  bucket: ScoredRecommendation['bucket'];
  generation_reason: string;
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

function normalizedMetricProfileId(profileId: string): string {
  const normalizedProfileId = profileId.trim().toLowerCase();
  if (!normalizedProfileId) throw new Error('profile recommendation metric profile is empty');
  return normalizedProfileId;
}

export function setRecommendationMetric(
  name: string,
  value: number,
  profileId = activeViewerProfileId(),
): void {
  const metricName = name.trim();
  if (!metricName) throw new Error('profile recommendation metric name is empty');
  libraryDatabase().prepare(`
INSERT INTO profile_recommendation_metrics(profile_id, metric_name, metric_value, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(profile_id, metric_name) DO UPDATE SET
  metric_value = excluded.metric_value,
  updated_at = excluded.updated_at
`).run(
    normalizedMetricProfileId(profileId),
    metricName,
    Math.max(0, Math.round(value)),
    Date.now(),
  );
}

export function incrementRecommendationMetric(name: string, profileId = activeViewerProfileId()): void {
  const metricName = name.trim();
  if (!metricName) throw new Error('profile recommendation metric name is empty');
  libraryDatabase().prepare(`
INSERT INTO profile_recommendation_metrics(profile_id, metric_name, metric_value, updated_at)
VALUES (?, ?, 1, ?)
ON CONFLICT(profile_id, metric_name) DO UPDATE SET
  metric_value = profile_recommendation_metrics.metric_value + 1,
  updated_at = excluded.updated_at
`).run(normalizedMetricProfileId(profileId), metricName, Date.now());
}

function contentTypeForTab(tab: ForYouTab): RatingContentType {
  return tab === 'movies' ? 'movie' : 'series';
}

function ratingGroupsForProfile(profileId: string): Array<ReturnType<typeof listRatings>> {
  if (profileId !== 'household') return [listRatings(undefined, profileId)];
  return listViewerProfiles()
    .map((profile) => listRatings(undefined, profile.profile_id))
    .filter((ratings) => ratings.length > 0);
}

function ratingsForProfile(profileId: string): ReturnType<typeof listRatings> {
  return ratingGroupsForProfile(profileId).flat();
}

const MOOD_TASTE_TAGS: Record<string, string[]> = {
  cozy: ['cozy', 'gentle', 'warm', 'comfort', 'wholesome', 'low stakes'],
  laugh: ['comedy', 'funny', 'witty', 'playful', 'satire'],
  thrilling: ['thriller', 'action', 'suspense', 'tense', 'fast', 'adventure'],
  deep: ['drama', 'thoughtful', 'complex', 'documentary', 'philosophical', 'cerebral'],
  family: ['family', 'animation', 'adventure', 'wholesome', 'all ages'],
};

export function recommendationMoodFeature(
  mood: string | null,
  type: RatingContentType,
): RecommendationFeature | null {
  const normalized = mood?.trim().toLowerCase() || '';
  if (!normalized) return null;
  return buildRecommendationFeature({
    type,
    id: `mood:${normalized}`,
    title: normalized,
    taste_tags: MOOD_TASTE_TAGS[normalized] ?? [normalized],
  });
}

export function mergeRatingWithVerifiedMetadata(
  rating: Pick<FireWaterRating, 'type' | 'id' | 'title' | 'year' | 'taste_tags'>,
  verified?: RecommendationAiInput,
): RecommendationAiInput {
  if (verified && (verified.type !== rating.type || verified.id !== rating.id)) {
    throw new Error('verified recommendation metadata must match the rating stable id');
  }
  return {
    type: rating.type,
    id: rating.id,
    title: verified?.title.trim() || rating.title,
    year: verified?.year ?? rating.year,
    rail_ids: verified?.rail_ids ? [...verified.rail_ids] : undefined,
    // These tags come from the reviewed rating seed/couch record and remain
    // authoritative even when fresher verified catalog metadata is available.
    taste_tags: [...rating.taste_tags],
  };
}

export function recommendationSignalPreferenceStrength(
  signal: Pick<
    ProfileRecommendationSignal,
    'strongest_positive' | 'saved' | 'last_positive_at' | 'last_event_at'
  >,
  now: number,
): number {
  if (signal.last_positive_at <= 0) return 0;
  const ageDays = Math.max(0, (now - signal.last_positive_at) / 86_400_000);
  const shortHorizon = Math.exp(-ageDays / 14);
  const longHorizon = Math.exp(-ageDays / 180);
  const recency = 0.65 * shortHorizon + 0.35 * longHorizon;
  const base = Math.max(signal.strongest_positive, signal.saved ? 0.8 : 0.05);
  return Math.max(0.02, Math.min(1, base * recency));
}

export function recommendationNegativeSignalStrength(
  signal: Pick<
    ProfileRecommendationSignal,
    'not_interested' | 'last_not_interested_at' | 'last_event_at'
  >,
  now: number,
): number {
  if (!signal.not_interested || signal.last_not_interested_at <= 0) return 0;
  const ageDays = Math.max(0, (now - signal.last_not_interested_at) / 86_400_000);
  // A semantic objection has a 90-day half-life. The exact title remains a
  // hard eligibility veto until Undo, but neighboring concepts recover.
  return Math.max(0, Math.min(1, 2 ** (-ageDays / 90)));
}

export function isCooledRecommendationRewatch(
  signal: Pick<ProfileRecommendationSignal, 'watched' | 'not_interested' | 'last_positive_at'>,
  now: number,
): boolean {
  return signal.watched
    && !signal.not_interested
    && signal.last_positive_at > 0
    && now - signal.last_positive_at >= VOD_REWATCH_COOLDOWN_MS;
}

function featureMetadataHash(feature: RecommendationFeature): string {
  return createHash('sha256')
    .update(JSON.stringify({
      type: feature.type,
      id: feature.id,
      title: feature.title,
      year: feature.year,
      rail_id: feature.rail_id,
      rail_ids: feature.rail_ids,
    }))
    .digest('hex');
}

function implicitPreferencesForProfile(
  profileId: string,
  featureByKey: Map<string, RecommendationFeature>,
  now: number,
  profileSignals?: ProfileRecommendationSignal[],
): ImplicitRecommendationPreference[] {
  const signals = profileSignals ?? listProfileRecommendationSignals({
    profile_id: profileId,
    domain: 'vod',
    household_blend: profileId === 'household',
    limit: 2_000,
  });
  return signals.filter((signal) => (
    !signal.not_interested
    && (signal.watched || signal.saved)
    && (signal.item_type === 'movie' || signal.item_type === 'series')
  )).flatMap((signal) => {
    const feature = featureByKey.get(`${signal.item_type}:${signal.item_id}`);
    if (!feature) return [];
    const strength = recommendationSignalPreferenceStrength(signal, now);
    return strength > 0 ? [{ feature, strength }] : [];
  }).slice(0, 200);
}

function implicitPreferenceGroupsForProfile(
  profileId: string,
  featureByKey: Map<string, RecommendationFeature>,
  now: number,
  aggregateSignals: ProfileRecommendationSignal[],
): ImplicitRecommendationPreference[][] {
  if (profileId !== 'household') {
    const preferences = implicitPreferencesForProfile(profileId, featureByKey, now, aggregateSignals);
    return preferences.length > 0 ? [preferences] : [];
  }
  return listViewerProfiles().map((profile) => implicitPreferencesForProfile(
    profile.profile_id,
    featureByKey,
    now,
    listProfileRecommendationSignals({
      profile_id: profile.profile_id,
      domain: 'vod',
      household_blend: false,
      limit: 10_000,
    }),
  )).filter((preferences) => preferences.length > 0);
}

function negativePreferencesForProfile(
  profileSignals: ProfileRecommendationSignal[],
  featureByKey: Map<string, RecommendationFeature>,
  now: number,
): NegativeRecommendationPreference[] {
  return profileSignals.filter((signal) => (
    signal.not_interested
    && (signal.item_type === 'movie' || signal.item_type === 'series')
  )).flatMap((signal) => {
    const feature = featureByKey.get(`${signal.item_type}:${signal.item_id}`);
    if (!feature) return [];
    const strength = recommendationNegativeSignalStrength(signal, now);
    return strength > 0.01 ? [{ feature, strength }] : [];
  }).sort((left, right) => right.strength - left.strength)
    .slice(0, 64);
}

export function recommendationPreferenceAiInputs(
  profileSignals: ProfileRecommendationSignal[],
  verifiedInputs: Map<string, RecommendationAiInput>,
): RecommendationAiInput[] {
  return [...new Map(profileSignals
    .filter((signal) => (
      (signal.watched || signal.saved || signal.not_interested)
      && (signal.item_type === 'movie' || signal.item_type === 'series')
    ))
    .flatMap((signal) => {
      const input = verifiedInputs.get(`${signal.item_type}:${signal.item_id}`);
      return input ? [[`${input.type}:${input.id}`, input] as const] : [];
    })).values()];
}

function persistFeatures(features: RecommendationFeature[], timestamp: number): void {
  const unique = new Map(features.map((feature) => [`${feature.type}:${feature.id}`, feature]));
  if (unique.size === 0) return;
  const db = libraryDatabase();
  const insert = db.prepare(`
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
`);
  // better-sqlite3 is synchronous by design. One prepared statement inside one
  // transaction keeps this bounded write phase short enough for the Pi instead
  // of paying prepare/autocommit cost once per candidate.
  db.transaction(() => {
    for (const feature of unique.values()) {
      insert.run(
        feature.type,
        feature.id,
        RECOMMENDATION_FEATURE_VERSION,
        featureMetadataHash(feature),
        feature.confidence,
        JSON.stringify({
          vector: feature.vector,
          cluster: feature.cluster,
          rail_id: feature.rail_id,
          rail_ids: feature.rail_ids,
        }),
        RECOMMENDATION_MODEL_VERSION,
        timestamp,
        timestamp,
      );
    }
  })();
}

function nextSnapshotRevision(tab: ForYouTab, profileId: string): number {
  const row = libraryDatabase().prepare(`
SELECT COALESCE(MAX(revision), 0) + 1 AS revision
FROM profile_recommendation_snapshots WHERE profile_id = ? AND tab = ?
`).get(profileId, tab) as { revision: number };
  return row.revision;
}

function publishSnapshot(
  tab: ForYouTab,
  ranked: ScoredRecommendation[],
  posterByKey: Map<string, string | null>,
  candidateCount: number,
  dailySeed: string,
  profileId: string,
): number {
  const db = libraryDatabase();
  const timestamp = Date.now();
  return db.transaction(() => {
    // Allocate the revision under the same SQLite write lock as publication.
    // Manual, nightly, and first-run refreshes may arrive concurrently; a
    // revision computed before BEGIN could otherwise be claimed twice.
    const revision = nextSnapshotRevision(tab, profileId);
    db.prepare(`
INSERT INTO profile_recommendation_snapshots (
  profile_id, tab, revision, model_version, model_kind, status, candidate_count, generated_at, daily_seed
) VALUES (?, ?, ?, ?, 'content-shrinkage', 'ready', ?, ?, ?)
`).run(profileId, tab, revision, RECOMMENDATION_MODEL_VERSION, candidateCount, timestamp, dailySeed);
    const insert = db.prepare(`
INSERT INTO profile_recommendation_snapshot_items (
  profile_id, tab, revision, rank, content_type, content_id, title, poster, year, bucket,
  affinity, diversity, predicted_fire, predicted_water, generation_reason
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
    ranked.forEach((item, index) => insert.run(
      profileId,
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
      item.couch_provenance === 'watch_again'
        ? 'cooled_rewatch'
        : item.bucket === 'explore'
          ? 'stable_daily_exploration'
          : 'dual_axis_affinity',
    ));
    db.prepare(`
DELETE FROM profile_recommendation_snapshots
WHERE profile_id = ? AND tab = ? AND revision NOT IN (
  SELECT revision FROM profile_recommendation_snapshots
  WHERE profile_id = ? AND tab = ? ORDER BY revision DESC LIMIT 8
)
`).run(profileId, tab, profileId, tab);
    return revision;
  })();
}

export type RefreshForYouResult = {
  tab: ForYouTab;
  revision: number;
  candidate_count: number;
  item_count: number;
};

async function refreshLegacyForYouUnserialized(
  tab: ForYouTab,
  expectedProfileId?: string,
): Promise<RefreshForYouResult> {
  const startedAt = Date.now();
  const type = contentTypeForTab(tab);
  const personalization = getPersonalizationState();
  const profileId = personalization.active_profile_id;
  if (expectedProfileId !== undefined && expectedProfileId !== profileId) {
    throw new Error(`recommendation refresh owner ${expectedProfileId} is no longer active`);
  }
  const [verified, transferVerified, ratings] = await Promise.all([
    listVerifiedLibraryCatalogRows(2000, type),
    type === 'series' ? listVerifiedLibraryCatalogRows(1200, 'movie') : Promise.resolve([]),
    Promise.resolve(ratingsForProfile(profileId)),
  ]);
  const profileSignals = listProfileRecommendationSignals({
    profile_id: profileId,
    domain: 'vod',
    household_blend: profileId === 'household',
    limit: 10_000,
  });
  const currentNegativeKeys = new Set(listProfileLibraryFeedback('not_interested', undefined, {
    profile_id: profileId,
    household_blend: profileId === 'household',
  }).map((row) => `${row.type}:${row.id}`));
  const profileSignalsByKey = new Map<string, ProfileRecommendationSignal>(profileSignals.map((signal) => [
    `${signal.item_type}:${signal.item_id}`,
    signal,
  ] as const));
  const ratedKeys = new Set(ratings.map((rating) => `${rating.type}:${rating.id}`));
  const signals = new Map<string, RecommendationLibrarySignal>(listRecommendationLibrarySignals({
    profile_id: profileId,
  })
    .map((signal) => [`${signal.type}:${signal.id}`, signal] as const));
  const preferred: typeof verified = [];
  const fallback: typeof verified = [];
  const cooledRewatch: typeof verified = [];
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
    const profileSignal = profileSignalsByKey.get(key);
    if (signal?.hidden || signal?.blocked || signal?.not_interested || currentNegativeKeys.has(key)) {
      excludedHard += 1;
      continue;
    }
    if (profileSignal?.watched || signal?.completed) {
      if (profileSignal && isCooledRecommendationRewatch(profileSignal, startedAt)) {
        cooledRewatch.push(candidate);
      }
      continue;
    }
    if (signal?.saved || signal?.started) fallback.push(candidate);
    else preferred.push(candidate);
  }
  const candidates = preferred.length >= 6 ? preferred : [...preferred, ...fallback];
  const candidateInputs: RecommendationAiInput[] = candidates.map((candidate) => ({
    type,
    id: candidate.id,
    title: candidate.title,
    year: candidate.year,
    rail_ids: candidate.rail_ids,
  }));
  const rewatchInputs: RecommendationAiInput[] = cooledRewatch.map((candidate) => ({
    type,
    id: candidate.id,
    title: candidate.title,
    year: candidate.year,
    rail_ids: candidate.rail_ids,
  }));
  const verifiedInputs = new Map<string, RecommendationAiInput>(
    [...verified, ...transferVerified]
      .filter((candidate) => candidate.type === 'movie' || candidate.type === 'series')
      .map((candidate) => {
        const input: RecommendationAiInput = {
          type: candidate.type as RatingContentType,
          id: candidate.id,
          title: candidate.title,
          year: candidate.year,
          rail_ids: candidate.rail_ids,
        };
        return [`${input.type}:${input.id}`, input] as const;
      }),
  );
  const ratingInputs = ratings.map((rating) => {
    const key = `${rating.type}:${rating.id}`;
    return mergeRatingWithVerifiedMetadata(rating, verifiedInputs.get(key));
  });
  const preferenceInputs = recommendationPreferenceAiInputs(profileSignals, verifiedInputs);
  const allAiInputs = [...ratingInputs, ...candidateInputs, ...rewatchInputs, ...preferenceInputs];
  // Refresh is a background/operator path. Cloud enrichment is bounded and
  // last-good; no launcher request ever waits on it.
  const aiRefresh = await refreshAiRecommendationFeatures(
    allAiInputs,
    { enabled: recommendationAiEnabled() },
  );
  const aiDocuments = recommendationAiEnabled()
    ? loadAiRecommendationFeatures(allAiInputs)
    : new Map();
  const features = candidateInputs.map((input) => buildAiEnrichedRecommendationFeature(
    input,
    aiDocuments.get(`${input.type}:${input.id}`),
  ));
  const rewatchFeatures = rewatchInputs.map((input) => buildAiEnrichedRecommendationFeature(
    input,
    aiDocuments.get(`${input.type}:${input.id}`),
  ));
  const verifiedFeatures = new Map<string, RecommendationFeature>(
    [...verifiedInputs.values()].map((input) => {
      const feature = buildAiEnrichedRecommendationFeature(
        input,
        aiDocuments.get(`${input.type}:${input.id}`),
      );
      return [`${feature.type}:${feature.id}`, feature] as const;
    }),
  );
  const ratingFeatures = new Map<string, RecommendationFeature>(ratingInputs.map((input) => {
    const key = `${input.type}:${input.id}`;
    return [key, buildAiEnrichedRecommendationFeature(input, aiDocuments.get(key))] as const;
  }));
  const timestamp = Date.now();
  const preferenceFeatures = preferenceInputs.map((input) => buildAiEnrichedRecommendationFeature(
    input,
    aiDocuments.get(`${input.type}:${input.id}`),
  ));
  persistFeatures(
    [...features, ...rewatchFeatures, ...ratingFeatures.values(), ...preferenceFeatures],
    timestamp,
  );
  const implicitPreferenceGroups = implicitPreferenceGroupsForProfile(
    profileId,
    verifiedFeatures,
    timestamp,
    profileSignals,
  );
  const implicitPreferences = implicitPreferenceGroups.flat();
  const negativePreferences = negativePreferencesForProfile(profileSignals, verifiedFeatures, timestamp);
  const evaluation = evaluateExplicitRatings(ratings, ratingFeatures);
  setRecommendationMetric(`evaluation_samples_last_${tab}`, evaluation.samples, profileId);
  if (evaluation.fire_mae !== null) {
    setRecommendationMetric(`evaluation_fire_mae_milli_last_${tab}`, evaluation.fire_mae * 1000, profileId);
    setRecommendationMetric(`evaluation_water_mae_milli_last_${tab}`, evaluation.water_mae! * 1000, profileId);
    setRecommendationMetric(`evaluation_affinity_mae_milli_last_${tab}`, evaluation.affinity_mae! * 1000, profileId);
  }
  const mood = personalization.mood;
  const dailySeed = `${recommendationDailySeed(tab)}:${profileId}:${mood ?? 'neutral'}`;
  const rewatchCadenceSeed = `${recommendationDailySeed(tab)}:${profileId}`;
  // Persist a deeper last-good reserve than the six cards sent to the launcher.
  // Eligibility can change between nightly runs (rating, hide, block), so the
  // loader needs enough already-ranked playable candidates to heal the rail
  // and rotate shuffles without putting generation on the couch-critical path.
  const ranked = await rankRecommendationsOffThread({
    tab,
    candidates: features,
    ratings,
    ratingFeatures,
    ratingGroups: ratingGroupsForProfile(profileId),
    implicitPreferences,
    implicitPreferenceGroups,
    negativePreferences,
    contextFeature: recommendationMoodFeature(mood, type),
    rewatchCandidates: rewatchFeatures,
    rewatchCadenceSeed,
    dailySeed,
    limit: FOR_YOU_RESERVE_LIMIT,
    visibleLimit: FOR_YOU_VISIBLE_LIMIT,
  });
  if (ranked.length < FOR_YOU_VISIBLE_LIMIT) {
    throw new Error(`For You ${tab} requires at least six eligible playable titles`);
  }
  const posterByKey = new Map<string, string | null>([...candidates, ...cooledRewatch].map((candidate) => [
    `${candidate.type}:${candidate.id}`,
    candidate.poster,
  ]));
  const currentPersonalization = getPersonalizationState();
  if (currentPersonalization.active_profile_id !== profileId
    || currentPersonalization.updated_at !== personalization.updated_at) {
    throw new Error('personalization changed during recommendation refresh');
  }
  const revision = publishSnapshot(tab, ranked, posterByKey, candidates.length, dailySeed, profileId);
  setRecommendationMetric(`generation_duration_ms_last_${tab}`, Date.now() - startedAt, profileId);
  setRecommendationMetric(`candidate_count_last_${tab}`, candidates.length, profileId);
  setRecommendationMetric(`excluded_rated_last_${tab}`, excludedRated, profileId);
  setRecommendationMetric(`excluded_hard_last_${tab}`, excludedHard, profileId);
  setRecommendationMetric(`rewatch_pool_last_${tab}`, cooledRewatch.length, profileId);
  setRecommendationMetric(`feature_metadata_last_${tab}`, features.length, profileId);
  setRecommendationMetric(`implicit_preferences_last_${tab}`, implicitPreferences.length, profileId);
  setRecommendationMetric(`implicit_viewer_groups_last_${tab}`, implicitPreferenceGroups.length, profileId);
  setRecommendationMetric(`implicit_only_cold_start_last_${tab}`, ratings.length === 0 ? 1 : 0, profileId);
  setRecommendationMetric(`negative_preferences_last_${tab}`, negativePreferences.length, profileId);
  setRecommendationMetric(`feature_ai_last_${tab}`, candidateInputs.filter(
    (input) => aiDocuments.has(`${input.type}:${input.id}`),
  ).length, profileId);
  setRecommendationMetric(`feature_ai_preferences_last_${tab}`, preferenceInputs.filter(
    (input) => aiDocuments.has(`${input.type}:${input.id}`),
  ).length, profileId);
  setRecommendationMetric(`ai_requested_last_${tab}`, aiRefresh.requested, profileId);
  setRecommendationMetric(`ai_persisted_last_${tab}`, aiRefresh.persisted, profileId);
  setRecommendationMetric(`ai_fallback_last_${tab}`, aiRefresh.failed ? 1 : 0, profileId);
  return { tab, revision, candidate_count: candidates.length, item_count: ranked.length };
}

async function refreshForYouUnserialized(
  tab: ForYouTab,
  expectedProfileId?: string,
  triggerReasons: readonly string[] = ['refresh'],
): Promise<RefreshForYouResult> {
  // Shadow keeps v4 warm for rollback comparison. Once serve is selected,
  // Story Graph is the only generation path and v4 cannot silently reappear.
  const mode = vodRecommendationsV2Mode();
  if (mode === 'off') return refreshLegacyForYouUnserialized(tab, expectedProfileId);
  if (mode === 'serve') {
    const storyGraph = await refreshStoryGraphForYou(tab, { trigger_reasons: triggerReasons });
    return {
      tab,
      revision: storyGraph.rank_generation_id,
      candidate_count: storyGraph.verified_count,
      item_count: storyGraph.reserve_depth,
    };
  }
  let legacy: RefreshForYouResult | null = null;
  let legacyError: unknown;
  try {
    legacy = await refreshLegacyForYouUnserialized(tab, expectedProfileId);
  } catch (error) {
    legacyError = error;
  }
  try {
    await refreshStoryGraphForYou(tab, { trigger_reasons: triggerReasons });
  } catch (error) {
    // Shadow work must not make the established v4 rail unavailable. Serve
    // mode propagates the failure so the coalescing worker records that it
    // retained last-good and retries normally.
    console.warn(`Story Graph shadow refresh retained v4 ${tab}: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  if (legacy) return legacy;
  throw legacyError ?? new Error(`no recommendation generation published for ${tab}`);
}

// Serialize the whole refresh per media type, not merely the final INSERT.
// Movies and Series own independent generations/tables and may progress in
// parallel; two callers for the same type may never interleave publication.
const refreshExecutor = new KeyedSerialExecutor<ForYouTab>();

export function refreshForYou(
  tab: ForYouTab,
  options: { profile_id?: string; trigger_reasons?: readonly string[] } = {},
): Promise<RefreshForYouResult> {
  return refreshExecutor.run(
    tab,
    () => refreshForYouUnserialized(tab, options.profile_id, options.trigger_reasons),
  );
}

export function currentRecommendationRevision(tab: ForYouTab): number {
  const profileId = activeViewerProfileId();
  const row = libraryDatabase().prepare(`
SELECT COALESCE(MAX(revision), 0) AS revision
FROM profile_recommendation_snapshots WHERE profile_id = ? AND tab = ?
`).get(profileId, tab) as { revision: number };
  return row.revision;
}

export function recommendationShuffleNonce(
  tab: ForYouTab,
  profileId = activeViewerProfileId(),
): number {
  const row = libraryDatabase().prepare(`
INSERT INTO profile_recommendation_metrics(profile_id, metric_name, metric_value, updated_at)
VALUES (?, ?, 1, ?)
ON CONFLICT(profile_id, metric_name) DO UPDATE SET
  metric_value = profile_recommendation_metrics.metric_value + 1,
  updated_at = excluded.updated_at
RETURNING metric_value
`).get(normalizedMetricProfileId(profileId), `shuffle_nonce_${tab}`, Date.now()) as { metric_value: number };
  return row.metric_value;
}

function stableShuffleRows(rows: SnapshotItemRow[], seed: string): SnapshotItemRow[] {
  return [...rows].sort((left, right) => {
    const leftHash = createHash('sha256').update(`${seed}:${left.content_type}:${left.content_id}`).digest('hex');
    const rightHash = createHash('sha256').update(`${seed}:${right.content_type}:${right.content_id}`).digest('hex');
    return leftHash.localeCompare(rightHash);
  });
}

export function selectVisibleRecommendationSlate(
  rows: SnapshotItemRow[],
  tab: ForYouTab,
  shuffleEpoch: number | boolean = 0,
  profileId?: string,
): SnapshotItemRow[] {
  // Boolean `false` keeps older unit callers working; `true` means "use the
  // current stored epoch without bumping" (tests that don't touch metrics).
  const epoch = typeof shuffleEpoch === 'boolean'
    ? (shuffleEpoch ? Math.max(1, currentForYouShuffleEpoch(tab, profileId)) : 0)
    : Math.max(0, Math.floor(shuffleEpoch));
  const seed = epoch > 0
    ? `${tab}:${rows[0]?.revision ?? 0}:${epoch}:${profileId ?? activeViewerProfileId()}`
    : null;
  const ordered = (bucket: string, candidates: SnapshotItemRow[]): SnapshotItemRow[] => (
    seed ? stableShuffleRows(candidates, `${seed}:${bucket}`) : candidates
  );
  const close = ordered('close', rows.filter((item) => item.bucket === 'close')).slice(0, 4);
  const adjacent = ordered('adjacent', rows.filter((item) => item.bucket === 'adjacent')).slice(0, 1);
  // Deeper reserve rows are intentionally tagged fallback. They are eligible
  // only for the bounded surprise slot when the original explore card becomes
  // rated, hidden, or no longer playable — and they also feed explore shuffle.
  const explore = ordered(
    'explore',
    rows.filter((item) => item.bucket === 'explore' || item.bucket === 'fallback'),
  ).slice(0, 1).map((item) => item.bucket === 'fallback'
    ? { ...item, bucket: 'explore' as const }
    : item);
  if (close.length !== 4 || adjacent.length !== 1 || explore.length !== 1) return [];
  return [...close, ...adjacent, ...explore];
}

export async function loadForYouRail(
  tab: ForYouTab,
  options: {
    reshuffle?: boolean;
    profileId?: string;
    personalizationUpdatedAt?: number;
  } = {},
): Promise<ForYouRail | null> {
  if (!forYouEnabled()) return null;
  if (vodRecommendationsV2Mode() === 'serve') {
    if (!hasPublishedStoryGraphGeneration(tab) || storyGraphPublishedHasNoTaste(tab)) return null;
    if (storyGraphPromotionEligible(tab)) {
      // A published v2 generation owns both ready and intentional empty states.
      // Couch-time work is limited to local slate dealing/revalidation.
      return loadStoryGraphForYouRail(tab, { reshuffle: options.reshuffle });
    }
    // A rank generation that has not passed the frozen gate remains shadow,
    // even if an operator accidentally selects serve early. Serve mode never
    // falls through to a personal/v4 snapshot.
    return null;
  }
  const personalization = getPersonalizationState();
  const profileId = options.profileId ?? personalization.active_profile_id;
  const personalizationUpdatedAt = options.personalizationUpdatedAt ?? personalization.updated_at;
  if (personalization.active_profile_id !== profileId
    || personalization.updated_at !== personalizationUpdatedAt) {
    return null;
  }
  const rows = libraryDatabase().prepare(`
SELECT rsi.revision, rsi.rank, rsi.content_type, rsi.content_id, rsi.title,
       rsi.poster, rsi.year, rsi.bucket, rsi.generation_reason
FROM profile_recommendation_snapshot_items rsi
WHERE rsi.profile_id = ? AND rsi.tab = ?
  AND rsi.revision = (
    SELECT MAX(revision) FROM profile_recommendation_snapshots
    WHERE profile_id = ? AND tab = ?
  )
ORDER BY rsi.rank ASC
LIMIT ${FOR_YOU_RESERVE_LIMIT}
  `).all(profileId, tab, profileId, tab) as SnapshotItemRow[];
  if (rows.length < FOR_YOU_VISIBLE_LIMIT) return null;
  const currentPlayability = await getTitlesPlayabilityBulk(rows.map((row) => ({
    type: row.content_type,
    id: row.content_id,
  })));
  const currentPersonalization = getPersonalizationState();
  if (currentPersonalization.active_profile_id !== profileId
    || currentPersonalization.updated_at !== personalizationUpdatedAt) {
    // The caller can immediately retry for the newly active profile. Never
    // assemble a single response from two profile snapshots.
    return null;
  }
  const currentlyVerified = new Set([...currentPlayability.entries()]
    .filter(([, record]) => record.status === 'verified')
    .map(([key]) => key));
  const ineligible = new Set(listRecommendationLibrarySignals({ profile_id: profileId })
    .filter((signal) => signal.hidden || signal.blocked || signal.not_interested)
    .map((signal) => `${signal.type}:${signal.id}`));
  for (const row of listProfileLibraryFeedback('not_interested', undefined, {
    profile_id: profileId,
    household_blend: profileId === 'household',
  })) {
    ineligible.add(`${row.type}:${row.id}`);
  }
  const rated = new Set(ratingsForProfile(profileId).map((rating) => `${rating.type}:${rating.id}`));
  const eligiblePool = rows.filter((row) => {
    const key = `${row.content_type}:${row.content_id}`;
    return currentlyVerified.has(key) && !ineligible.has(key) && !rated.has(key);
  });
  let epoch = currentForYouShuffleEpoch(tab, profileId);
  if (options.reshuffle) epoch = recommendationShuffleNonce(tab, profileId);
  // Visible contract is always six cards: 4 close / 1 adjacent / 1 surprise.
  // A deeper last-good reserve stays in the snapshot for healing and shuffle;
  // only this 4/1/1 window is sent to the launcher. Epoch seeds rotation without
  // bumping the nonce on ordinary loads.
  const visible = selectVisibleRecommendationSlate(
    eligiblePool,
    tab,
    epoch,
    profileId,
  );
  if (visible.length < FOR_YOU_VISIBLE_LIMIT) return null;
  const finalPersonalization = getPersonalizationState();
  if (finalPersonalization.active_profile_id !== profileId
    || finalPersonalization.updated_at !== personalizationUpdatedAt) {
    return null;
  }
  const railId = tab === 'movies' ? 'for-you-movies' : 'for-you-series';
  const served = registerRecommendationServedSlate({
    profile_id: profileId,
    domain: 'vod',
    rail_id: railId,
    source_revision: rows[0]?.revision ?? 0,
    items: visible.map((row, rank) => ({
      type: row.content_type,
      id: row.content_id,
      rank,
    })),
  });
  return {
    rail_id: railId,
    label: 'For You',
    slate_sequence: served.slate_revision,
    attribution_token: served.attribution_token,
    items: visible.map((row) => ({
      id: row.content_id,
      type: row.content_type,
      title: row.title,
      subtitle: [
        row.generation_reason === 'cooled_rewatch'
          ? 'Watch again'
          : row.content_type === 'movie' ? 'Movie' : 'TV Show',
        row.year,
      ].filter(Boolean).join(' · '),
      poster: row.poster ?? '',
      ...(row.year ? { year: row.year } : {}),
      source: 'for-you',
    })),
    resolve_ms: 0,
    skipped: rows.length - visible.length,
    cached: true,
    playability: {
      displayed: visible.length,
      verified_pool: eligiblePool.length,
      pending: 0,
      low_water: visible.length < FOR_YOU_VISIBLE_LIMIT,
      session_id: `for-you-${rows[0]?.revision ?? 0}-${epoch}`,
    },
  };
}

function currentForYouShuffleEpoch(tab: ForYouTab, profileId = activeViewerProfileId()): number {
  const row = libraryDatabase().prepare(`
SELECT metric_value FROM profile_recommendation_metrics
WHERE profile_id = ? AND metric_name = ?
`).get(normalizedMetricProfileId(profileId), `shuffle_nonce_${tab}`) as { metric_value?: number } | undefined;
  return Math.max(0, Math.floor(Number(row?.metric_value) || 0));
}

/**
 * Helper for rotating a flat eligible pool with light era diversity. The live
 * For You rail uses {@link selectVisibleRecommendationSlate} (6-card 4/1/1);
 * this remains for unit coverage of reserve rotation mechanics.
 */
export function pickForYouDisplayWindow<T extends {
  content_id: string;
  year: string | null;
}>(
  eligible: T[],
  options: { limit: number; seed: string; reshuffle: boolean },
): T[] {
  if (eligible.length <= options.limit && !options.reshuffle) return eligible.slice(0, options.limit);
  const rotated = (() => {
    if (!options.reshuffle) return eligible;
    const offset = Math.floor(seededUnit(`${options.seed}:offset`) * eligible.length) % eligible.length;
    return [...eligible.slice(offset), ...eligible.slice(0, offset)];
  })();
  const selected: T[] = [];
  const eraCount = new Map<string, number>();
  const maxPerEra = options.limit <= 8 ? 3 : 4;
  for (const row of rotated) {
    if (selected.length >= options.limit) break;
    const year = Number.parseInt(row.year ?? '', 10);
    const era = Number.isFinite(year) ? String(Math.floor(year / 10) * 10) : 'unknown';
    if ((eraCount.get(era) ?? 0) >= maxPerEra) continue;
    selected.push(row);
    eraCount.set(era, (eraCount.get(era) ?? 0) + 1);
  }
  // If era caps left the rail short, fill from remaining rotated order.
  if (selected.length < Math.min(options.limit, rotated.length)) {
    const used = new Set(selected.map((row) => row.content_id));
    for (const row of rotated) {
      if (selected.length >= options.limit) break;
      if (used.has(row.content_id)) continue;
      selected.push(row);
    }
  }
  return selected;
}

function seededUnit(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0) / 0xffffffff;
}

export function recommendationDiagnostics(): {
  enabled: boolean;
  ai_enabled: boolean;
  active_profile_id: string;
  ratings: number;
  tabs: Array<{ tab: ForYouTab; revision: number; generated_at: number | null; candidate_count: number }>;
  metrics_scope: { kind: 'active_profile'; profile_id: string };
  metrics: Record<string, { value: number; updated_at: number }>;
  legacy_global_metrics: Record<string, { value: number; updated_at: number }>;
  refresh_jobs: RecommendationRefreshJob[];
  vod_v2_mode: ReturnType<typeof vodRecommendationsV2Mode>;
  story_graph: ReturnType<typeof storyGraphDiagnostics>;
  story_graph_serving_work: ReturnType<typeof storyGraphServingWorkSnapshot>;
  attribution_rollup: Array<{
    domain: 'vod' | 'youtube';
    rail_id: string;
    slate_revision: number;
    model_version: string | null;
    impressions: number;
    detail_opens: number;
    play_starts: number;
    completions_90pct: number;
    last_activity_at: number;
  }>;
} {
  const profileId = activeViewerProfileId();
  const ratings = ratingsForProfile(profileId).length;
  const rows = libraryDatabase().prepare(`
SELECT rs.tab, rs.revision, rs.generated_at, rs.candidate_count
FROM profile_recommendation_snapshots rs
JOIN (
  SELECT tab, MAX(revision) AS revision FROM profile_recommendation_snapshots
  WHERE profile_id = ? GROUP BY tab
) latest ON latest.tab = rs.tab AND latest.revision = rs.revision
WHERE rs.profile_id = ?
ORDER BY rs.tab
  `).all(profileId, profileId) as Array<{ tab: ForYouTab; revision: number; generated_at: number; candidate_count: number }>;
  const metricRows = libraryDatabase().prepare(`
SELECT metric_name, metric_value, updated_at
FROM profile_recommendation_metrics
WHERE profile_id = ?
ORDER BY metric_name
`).all(profileId) as Array<{ metric_name: string; metric_value: number; updated_at: number }>;
  const legacyMetricRows = libraryDatabase().prepare(`
SELECT metric_name, metric_value, updated_at
FROM recommendation_metrics
ORDER BY metric_name
`).all() as Array<{ metric_name: string; metric_value: number; updated_at: number }>;
  const attributionRollup = libraryDatabase().prepare(`
WITH attribution_keys AS (
  SELECT profile_id, domain, rail_id, slate_revision
  FROM profile_recommendation_impressions
  WHERE profile_id = ?
  UNION
  SELECT profile_id, domain, rail_id, slate_revision
  FROM profile_recommendation_outcomes
  WHERE profile_id = ?
)
SELECT k.domain, k.rail_id, k.slate_revision, prs.model_version,
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
LEFT JOIN profile_recommendation_snapshots prs
  ON prs.profile_id = k.profile_id
 AND k.domain = 'vod'
 AND prs.revision = served.source_revision
 AND prs.tab = CASE k.rail_id
   WHEN 'for-you-movies' THEN 'movies'
   WHEN 'for-you-series' THEN 'series'
   ELSE NULL
 END
ORDER BY last_activity_at DESC, k.domain, k.rail_id, k.slate_revision DESC
LIMIT 40
`).all(profileId, profileId) as Array<{
    domain: 'vod' | 'youtube';
    rail_id: string;
    slate_revision: number;
    model_version: string | null;
    impressions: number;
    detail_opens: number;
    play_starts: number;
    completions_90pct: number;
    last_activity_at: number;
  }>;
  return {
    enabled: forYouEnabled(),
    ai_enabled: recommendationAiEnabled(),
    active_profile_id: profileId,
    ratings,
    metrics_scope: { kind: 'active_profile', profile_id: profileId },
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
    legacy_global_metrics: Object.fromEntries(legacyMetricRows.map((row) => [
      row.metric_name,
      { value: row.metric_value, updated_at: row.updated_at },
    ])),
    refresh_jobs: listRecommendationRefreshJobs(20),
    vod_v2_mode: vodRecommendationsV2Mode(),
    story_graph: storyGraphDiagnostics(),
    story_graph_serving_work: storyGraphServingWorkSnapshot(),
    attribution_rollup: attributionRollup,
  };
}

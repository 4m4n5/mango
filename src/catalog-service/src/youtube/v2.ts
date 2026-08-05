import { createHash } from 'node:crypto';
import {
  listProfileLibraryFeedback,
  listMeaningfullyWatchedLibraryItemIdsPage,
  listSavedLibraryItemIdsPage,
  listWatchHistory,
} from '../library/db.js';
import { loadYoutubeConfig } from './config.js';
import {
  getYoutubeItem,
  getYoutubeState,
  latestYoutubeV2Generation,
  latestYoutubeV2GenerationRecord,
  latestYoutubeV2TakeoutImport,
  listYoutubeV2CandidateProvenance,
  listYoutubeV2ImportedHistory,
  listYoutubeV2ImportedHistoryIdsPage,
  listYoutubeV2Subscriptions,
  publishYoutubeV2Generation,
  setYoutubeState,
  youtubeV2CandidateProvenanceSummary,
  type YoutubeV2CandidateProvenance,
  type YoutubeV2Generation,
  type YoutubeV2GenerationItemInput,
  type YoutubeV2Provenance,
} from './db.js';
import { YOUTUBE_RAIL_LIMIT } from './constants.js';
import type { YoutubeItem, YoutubeRail, YoutubeRailItem } from './types.js';

export const YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION = 'youtube-household-v2.2';
export const YOUTUBE_V2_CANDIDATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const YOUTUBE_V2_LIVE_TTL_MS = 15 * 60 * 1000;
const V2_RESERVE_LIMIT = 120;
const V2_PROVENANCE_LIMIT = 50_000;
const V2_WATCH_LIMIT = 5_000;
const V2_EXCLUSION_PAGE_SIZE = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WATCH_HALF_LIFE_DAYS = 90;
const LOCAL_PARTIAL_STRENGTH = 0.55;
const LOCAL_COMPLETION_STRENGTH = 1;
const TAKEOUT_STRENGTH = 0.55;
const WATCH_PER_VIDEO_STRENGTH_CAP = 3;

export type YoutubeRecommendationsV2Mode = 'off' | 'shadow' | 'serve';

export function youtubeRecommendationsV2Mode(
  raw = process.env.MANGO_YOUTUBE_RECS_V2,
): YoutubeRecommendationsV2Mode {
  const normalized = raw?.trim().toLowerCase();
  return normalized === 'shadow' || normalized === 'serve' ? normalized : 'off';
}

/**
 * The service result and served-slate tokens retain their recommendation owner
 * (Household in v2 serve). The public HTTP envelope instead echoes the active
 * personalization owner and revision that fenced the request. Keeping these
 * authorities separate lets YouTube serve Household recommendations without
 * taking over VOD profile/mood UI.
 */
export function youtubePublicPersonalizationPayload<T extends {
  profile_id: string;
  personalization_updated_at: number;
}>(
  payload: T,
  personalization: { active_profile_id: string; updated_at: number },
): T {
  return {
    ...payload,
    profile_id: personalization.active_profile_id,
    personalization_updated_at: personalization.updated_at,
  };
}

export type YoutubeV2SourceStaleState = {
  stale: boolean;
  reason: string | null;
  at: number | null;
  [key: string]: unknown;
};

export function youtubeV2SourceStaleState(): YoutubeV2SourceStaleState {
  return getYoutubeState<YoutubeV2SourceStaleState>('youtube_v2_source_stale', {
    stale: false,
    reason: null,
    at: null,
  });
}

type WatchAnchor = {
  id: string;
  title: string;
  channel_id: string | null;
  channel_title: string | null;
  watched_at: number;
  base_strength: number;
  decayed_strength: number;
  source: 'mango' | 'takeout' | 'mixed';
};

export type YoutubeV2TopicSeed = {
  kind: 'history' | 'subscription';
  item: YoutubeItem;
  provenance_ref: string;
  source_generation: string;
};

type RankedCandidate = {
  item: YoutubeItem;
  rows: YoutubeV2CandidateProvenance[];
  history_affinity: number;
  subscription_affinity: number;
  score: number;
};

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

function creatorKey(item: YoutubeItem): string {
  return item.channel_id?.trim() || normalizedText(item.channel_title) || `video:${item.id}`;
}

function isShort(item: YoutubeItem): boolean {
  // The API cache does not carry aspect ratio. YouTube's current Shorts rule
  // includes square/vertical uploads up to three minutes, so fail closed on
  // duration to guarantee Shorts never reach a couch recommendation rail.
  return (item.duration_sec !== null && item.duration_sec <= 180)
    || /(^|\s)#shorts?\b/i.test(`${item.title} ${item.description ?? ''}`);
}

function isLive(item: YoutubeItem): boolean {
  return item.live_status === 'live';
}

function isLiveLike(item: YoutubeItem): boolean {
  return item.live_status === 'live' || item.live_status === 'upcoming';
}

function decayedWatchStrength(base: number, watchedAt: number, at: number): number {
  const ageDays = Math.max(0, (at - watchedAt) / DAY_MS);
  return base * (0.5 ** (ageDays / WATCH_HALF_LIFE_DAYS));
}

function meaningfulLocalStrength(row: {
  position_sec: number;
  duration_sec: number;
  progress_pct: number;
  event: string;
}): number | null {
  const completed = row.progress_pct >= 0.9 || /(?:complete|finish|ended|credits)/i.test(row.event);
  if (completed) return LOCAL_COMPLETION_STRENGTH;
  const position = Math.max(0, Number(row.position_sec || 0));
  const duration = Math.max(0, Number(row.duration_sec || 0));
  const threshold = duration > 0 ? Math.min(duration * 0.25, 5 * 60) : 2 * 60;
  return position >= threshold ? LOCAL_PARTIAL_STRENGTH : null;
}

function householdWatchAnchors(at = Date.now()): WatchAnchor[] {
  const merged = new Map<string, WatchAnchor>();
  const eventTimes = new Map<string, number[]>();
  const addEvent = (anchor: WatchAnchor) => {
    const times = eventTimes.get(anchor.id) ?? [];
    if (times.some((timestamp) => Math.abs(timestamp - anchor.watched_at) <= 60_000)) return;
    times.push(anchor.watched_at);
    eventTimes.set(anchor.id, times);
    const current = merged.get(anchor.id);
    if (!current) {
      merged.set(anchor.id, anchor);
      return;
    }
    const newest = anchor.watched_at > current.watched_at ? anchor : current;
    merged.set(anchor.id, {
      ...newest,
      watched_at: Math.max(current.watched_at, anchor.watched_at),
      base_strength: Math.min(
        WATCH_PER_VIDEO_STRENGTH_CAP,
        current.base_strength + anchor.base_strength,
      ),
      decayed_strength: Math.min(
        WATCH_PER_VIDEO_STRENGTH_CAP,
        current.decayed_strength + anchor.decayed_strength,
      ),
      source: current.source === anchor.source ? current.source : 'mixed',
    });
  };
  const localSessions = new Map<string, WatchAnchor>();
  for (const row of listWatchHistory({
    source: 'youtube',
    type: 'youtube_video',
    profile_id: 'household',
    household_blend: false,
    limit: 500,
  })) {
    const baseStrength = meaningfulLocalStrength(row);
    if (baseStrength === null) continue;
    const cached = getYoutubeItem('video', row.id);
    const anchor: WatchAnchor = {
      id: row.id,
      title: cached?.title || row.title || row.id,
      channel_id: cached?.channel_id ?? null,
      channel_title: cached?.channel_title ?? null,
      watched_at: row.watched_at,
      base_strength: baseStrength,
      decayed_strength: decayedWatchStrength(baseStrength, row.watched_at, at),
      source: 'mango',
    };
    const sessionKey = `${row.id}\u0000${row.play_id || row.history_id}`;
    const current = localSessions.get(sessionKey);
    if (!current
      || anchor.base_strength > current.base_strength
      || (anchor.base_strength === current.base_strength && anchor.watched_at > current.watched_at)) {
      localSessions.set(sessionKey, anchor);
    }
  }
  localSessions.forEach(addEvent);
  for (const row of listYoutubeV2ImportedHistory(V2_WATCH_LIMIT)) {
    const cached = getYoutubeItem('video', row.video_id);
    const anchor: WatchAnchor = {
      id: row.video_id,
      title: cached?.title || row.title,
      channel_id: cached?.channel_id || row.channel_id,
      channel_title: cached?.channel_title || row.channel_title,
      watched_at: row.watched_at,
      base_strength: TAKEOUT_STRENGTH,
      decayed_strength: decayedWatchStrength(TAKEOUT_STRENGTH, row.watched_at, at),
      source: 'takeout',
    };
    addEvent(anchor);
  }
  return [...merged.values()]
    .sort((left, right) => right.watched_at - left.watched_at || left.id.localeCompare(right.id))
    .slice(0, V2_WATCH_LIMIT);
}

function allHouseholdHistoryIds(): Set<string> {
  const ids = new Set<string>();
  let afterItemKey = '';
  while (true) {
    const page = listMeaningfullyWatchedLibraryItemIdsPage({
      source: 'youtube',
      type: 'youtube_video',
      profile_id: 'household',
      household_blend: false,
      after_item_key: afterItemKey,
      limit: V2_EXCLUSION_PAGE_SIZE,
    });
    page.forEach((row) => ids.add(row.id));
    if (page.length < V2_EXCLUSION_PAGE_SIZE) break;
    const next = page.at(-1)!.item_key;
    if (next <= afterItemKey) break;
    afterItemKey = next;
  }
  let afterVideoId = '';
  while (true) {
    const page = listYoutubeV2ImportedHistoryIdsPage({
      after_video_id: afterVideoId,
      limit: V2_EXCLUSION_PAGE_SIZE,
    });
    page.forEach((id) => ids.add(id));
    if (page.length < V2_EXCLUSION_PAGE_SIZE) break;
    const next = page.at(-1)!;
    if (next <= afterVideoId) break;
    afterVideoId = next;
  }
  return ids;
}

function householdSavedIds(): Set<string> {
  const ids = new Set<string>();
  let afterItemKey = '';
  while (true) {
    const page = listSavedLibraryItemIdsPage({
      source: 'youtube',
      type: 'youtube_video',
      profile_id: 'household',
      household_blend: false,
      after_item_key: afterItemKey,
      limit: V2_EXCLUSION_PAGE_SIZE,
    });
    page.forEach((row) => ids.add(row.id));
    if (page.length < V2_EXCLUSION_PAGE_SIZE) break;
    const next = page.at(-1)!.item_key;
    if (next <= afterItemKey) break;
    afterItemKey = next;
  }
  return ids;
}

function householdBlockedIds(): Set<string> {
  return new Set(listProfileLibraryFeedback('not_interested', 'youtube', {
    profile_id: 'household',
    household_blend: false,
  })
    .filter((row) => row.type === 'youtube_video')
    .map((row) => row.id));
}

export function youtubeV2ExactExcludedIds(): Set<string> {
  return new Set([
    ...allHouseholdHistoryIds(),
    ...householdSavedIds(),
    ...householdBlockedIds(),
  ]);
}

function authoritativeSubscriptions(): ReturnType<typeof listYoutubeV2Subscriptions> {
  return listYoutubeV2Subscriptions().filter((row) => row.source === 'oauth');
}

function cachedOrStub(anchor: WatchAnchor): YoutubeItem {
  return getYoutubeItem('video', anchor.id) ?? {
    id: anchor.id,
    kind: 'video',
    title: anchor.title,
    subtitle: anchor.channel_title || 'YouTube',
    description: null,
    thumbnail: null,
    channel_id: anchor.channel_id,
    channel_title: anchor.channel_title,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: anchor.watched_at,
  };
}

function pacificDay(at: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(at));
}

type PersistedTopicSeed = {
  day: string;
  kind: YoutubeV2TopicSeed['kind'];
  provenance_ref: string;
  item_id: string;
  source_generation: string;
  selected_at: number;
};

export function weightedDailyHistorySeedId(
  candidates: ReadonlyArray<{ id: string; weight: number }>,
  day: string,
): string | null {
  const eligible = candidates
    .filter((candidate) => candidate.id.trim() && Number.isFinite(candidate.weight) && candidate.weight > 0)
    .map((candidate) => ({ id: candidate.id, weight: candidate.weight }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (eligible.length === 0) return null;
  const total = eligible.reduce((sum, candidate) => sum + candidate.weight, 0);
  let needle = (stableHash(`youtube-v2:history-weighted:${day}:${eligible.map((row) => row.id).join(',')}`)
    / 0x1_0000_0000) * total;
  for (const candidate of eligible) {
    needle -= candidate.weight;
    if (needle <= 0) return candidate.id;
  }
  return eligible.at(-1)!.id;
}

function historyTopicSeed(watches: WatchAnchor[], at: number): YoutubeV2TopicSeed | null {
  const recent = watches.slice(0, 20);
  if (recent.length === 0) return null;
  const day = pacificDay(at);
  const persisted = getYoutubeState<PersistedTopicSeed | null>('youtube_v2_daily_topic_seed', null);
  const retained = persisted?.day === day && persisted.kind === 'history'
    ? recent.find((watch) => watch.id === persisted.item_id)
    : null;
  const selectedId = retained?.id ?? weightedDailyHistorySeedId(
    recent.map((watch) => ({ id: watch.id, weight: watch.decayed_strength })),
    day,
  );
  const selected = retained ?? recent.find((watch) => watch.id === selectedId) ?? recent[0]!;
  const sourceGeneration = createHash('sha256')
    .update(`history:${selected.id}:${selected.watched_at}:${selected.source}`)
    .digest('hex');
  if (!retained || persisted?.source_generation !== sourceGeneration) {
    setYoutubeState('youtube_v2_daily_topic_seed', {
      day,
      kind: 'history',
      provenance_ref: selected.id,
      item_id: selected.id,
      source_generation: sourceGeneration,
      selected_at: at,
    } satisfies PersistedTopicSeed);
  }
  return {
    kind: 'history',
    item: cachedOrStub(selected),
    provenance_ref: selected.id,
    source_generation: sourceGeneration,
  };
}

function subscriptionTopicSeed(
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  provenance: YoutubeV2CandidateProvenance[],
  at: number,
): YoutubeV2TopicSeed | null {
  if (subscriptions.length === 0) return null;
  const ordered = [...subscriptions].sort((left, right) => left.channel_key.localeCompare(right.channel_key));
  const day = pacificDay(at);
  const persisted = getYoutubeState<PersistedTopicSeed | null>('youtube_v2_daily_topic_seed', null);
  const retained = persisted?.day === day && persisted.kind === 'subscription'
    ? ordered.find((subscription) => `subscription:${subscription.channel_key}` === persisted.provenance_ref)
    : null;
  const selected = retained ?? ordered[
    stableHash(`youtube-v2:subscription:${day}:${ordered.map((row) => row.channel_key).join(',')}`) % ordered.length
  ]!;
  const provenanceRef = `subscription:${selected.channel_key}`;
  const uploads = provenance
    .filter((row) => row.provenance === 'subscription_upload')
    .filter((row) => row.provenance_ref === selected.channel_key || row.provenance_ref === selected.channel_id)
    .sort((left, right) => right.acquired_at - left.acquired_at || left.item.id.localeCompare(right.item.id));
  const retainedUpload = persisted?.day === day
    && persisted.kind === 'subscription'
    && persisted.provenance_ref === provenanceRef
    ? uploads.find((row) => row.item.id === persisted.item_id)
    : null;
  const upload = retainedUpload ?? uploads[0] ?? null;
  const item: YoutubeItem = upload?.item ?? {
    id: provenanceRef,
    kind: 'video',
    title: selected.channel_title,
    subtitle: selected.channel_title,
    description: null,
    thumbnail: null,
    channel_id: selected.channel_id,
    channel_title: selected.channel_title,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: selected.imported_at,
  };
  const sourceGeneration = createHash('sha256')
    .update(`subscription:${selected.source_generation}:${selected.channel_key}:${item.id}`)
    .digest('hex');
  if (!retained || persisted?.item_id !== item.id || persisted?.source_generation !== sourceGeneration) {
    setYoutubeState('youtube_v2_daily_topic_seed', {
      day,
      kind: 'subscription',
      provenance_ref: provenanceRef,
      item_id: item.id,
      source_generation: sourceGeneration,
      selected_at: at,
    } satisfies PersistedTopicSeed);
  }
  return {
    kind: 'subscription',
    item,
    provenance_ref: provenanceRef,
    source_generation: sourceGeneration,
  };
}

function topicSeedFromSources(
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  provenance: YoutubeV2CandidateProvenance[],
  at: number,
): YoutubeV2TopicSeed | null {
  return historyTopicSeed(watches, at) ?? subscriptionTopicSeed(subscriptions, provenance, at);
}

export function youtubeV2TopicSeed(at = Date.now()): YoutubeV2TopicSeed | null {
  return topicSeedFromSources(
    householdWatchAnchors(at),
    authoritativeSubscriptions(),
    listYoutubeV2CandidateProvenance({ at, limit: V2_PROVENANCE_LIMIT }),
    at,
  );
}

/** Diverse auditable seeds for Beyond acquisition; More Like still owns the daily seed above. */
export function youtubeV2DiscoverySeeds(limit = 8, at = Date.now()): YoutubeV2TopicSeed[] {
  const max = Math.max(1, Math.min(12, Math.floor(limit)));
  const watches = householdWatchAnchors(at).slice(0, 20);
  const subscriptions = authoritativeSubscriptions();
  const provenance = listYoutubeV2CandidateProvenance({ at, limit: V2_PROVENANCE_LIMIT });
  const primary = topicSeedFromSources(watches, subscriptions, provenance, at);
  const history: YoutubeV2TopicSeed[] = [];
  const seenHistoryCreators = new Set<string>();
  for (const watch of [...watches].sort((left, right) => (
    right.decayed_strength - left.decayed_strength
    || right.watched_at - left.watched_at
    || left.id.localeCompare(right.id)
  ))) {
    const creator = watch.channel_id || normalizedText(watch.channel_title) || watch.id;
    if (seenHistoryCreators.has(creator)) continue;
    seenHistoryCreators.add(creator);
    history.push({
      kind: 'history',
      item: cachedOrStub(watch),
      provenance_ref: watch.id,
      source_generation: createHash('sha256')
        .update(`history:${watch.id}:${watch.watched_at}:${watch.source}`)
        .digest('hex'),
    });
  }
  const subscription: YoutubeV2TopicSeed[] = [...subscriptions]
    .sort((left, right) => (
      stableHash(`youtube-v2:beyond:${pacificDay(at)}:${left.channel_key}`)
        - stableHash(`youtube-v2:beyond:${pacificDay(at)}:${right.channel_key}`)
      || left.channel_key.localeCompare(right.channel_key)
    ))
    .map((row) => {
      const upload = provenance
        .filter((entry) => entry.provenance === 'subscription_upload')
        .filter((entry) => entry.provenance_ref === row.channel_key || entry.provenance_ref === row.channel_id)
        .sort((left, right) => right.acquired_at - left.acquired_at || left.item.id.localeCompare(right.item.id))[0];
      const item = upload?.item ?? {
        id: `subscription:${row.channel_key}`,
        kind: 'video' as const,
        title: row.channel_title,
        subtitle: row.channel_title,
        description: null,
        thumbnail: null,
        channel_id: row.channel_id,
        channel_title: row.channel_title,
        published_at: null,
        duration_sec: null,
        live_status: 'none' as const,
        playlist_id: null,
        updated_at: row.imported_at,
      };
      return {
        kind: 'subscription' as const,
        item,
        provenance_ref: `subscription:${row.channel_key}`,
        source_generation: createHash('sha256')
          .update(`subscription:${row.source_generation}:${row.channel_key}:${item.id}`)
          .digest('hex'),
      };
    });
  const interleaved: YoutubeV2TopicSeed[] = [];
  for (let index = 0; index < Math.max(history.length, subscription.length); index += 1) {
    if (history[index]) interleaved.push(history[index]!);
    if (subscription[index]) interleaved.push(subscription[index]!);
  }
  const output: YoutubeV2TopicSeed[] = [];
  const seen = new Set<string>();
  for (const seed of [primary, ...interleaved]) {
    if (!seed || seen.has(seed.provenance_ref)) continue;
    seen.add(seed.provenance_ref);
    output.push(seed);
    if (output.length >= max) break;
  }
  return output;
}

export function isResolvedYoutubeHistoryItem(item: YoutubeItem | null): item is YoutubeItem {
  return Boolean(
    item
    && item.kind === 'video'
    && item.id.trim()
    && item.title.trim()
    && item.thumbnail?.trim()
    && item.channel_id?.trim(),
  );
}

export function youtubeV2HistoryItems(limit = 60): YoutubeRailItem[] {
  type HistoryEntry = { item: YoutubeItem; watched_at: number };
  const merged = new Map<string, HistoryEntry>();
  for (const row of listWatchHistory({
    source: 'youtube',
    type: 'youtube_video',
    profile_id: 'household',
    household_blend: false,
    limit: V2_WATCH_LIMIT,
  })) {
    const item = getYoutubeItem('video', row.id);
    if (!isResolvedYoutubeHistoryItem(item)) continue;
    const current = merged.get(row.id);
    if (!current || row.watched_at > current.watched_at) {
      merged.set(row.id, { item, watched_at: row.watched_at });
    }
  }
  for (const row of listYoutubeV2ImportedHistory(V2_WATCH_LIMIT)) {
    const item = getYoutubeItem('video', row.video_id);
    if (!isResolvedYoutubeHistoryItem(item)) continue;
    const current = merged.get(row.video_id);
    if (!current || row.watched_at > current.watched_at) {
      merged.set(row.video_id, { item, watched_at: row.watched_at });
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.watched_at - left.watched_at || left.item.id.localeCompare(right.item.id))
    .slice(0, Math.max(1, Math.min(V2_WATCH_LIMIT, Math.floor(limit))))
    .map(({ item }, index) => ({ ...item, score: 1 - index * 0.001, reason: null }));
}

function stableSourceHash(
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  provenance: YoutubeV2CandidateProvenance[],
  watchedIds: Set<string>,
  savedIds: Set<string>,
  blockedIds: Set<string>,
  topicSeed: YoutubeV2TopicSeed | null,
  at: number,
): string {
  const digest = createHash('sha256');
  digest.update(YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION);
  for (const row of [...watches].sort((left, right) => left.id.localeCompare(right.id))) {
    digest.update(`\nw:${row.id}:${row.watched_at}:${row.base_strength}:${row.source}`);
  }
  for (const row of [...subscriptions].sort((left, right) => left.channel_key.localeCompare(right.channel_key))) {
    digest.update(`\ns:${row.channel_key}:${row.channel_id ?? ''}:${row.source_generation}`);
  }
  for (const row of [...provenance].sort((left, right) => (
    left.item.id.localeCompare(right.item.id)
    || left.provenance.localeCompare(right.provenance)
    || left.provenance_ref.localeCompare(right.provenance_ref)
  ))) {
    digest.update(`\np:${row.item.id}:${row.provenance}:${row.provenance_ref}:${row.source_generation}:${row.expires_at}`);
  }
  for (const id of [...watchedIds].sort()) digest.update(`\nx:watched:${id}`);
  for (const id of [...savedIds].sort()) digest.update(`\nx:saved:${id}`);
  for (const id of [...blockedIds].sort()) digest.update(`\nx:blocked:${id}`);
  if (topicSeed) {
    digest.update(`\nseed:${pacificDay(at)}:${topicSeed.kind}:${topicSeed.provenance_ref}:${topicSeed.item.id}:${topicSeed.source_generation}`);
  }
  return digest.digest('hex');
}

function matchingSubscriptions(
  item: YoutubeItem,
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
): ReturnType<typeof listYoutubeV2Subscriptions> {
  const channelName = normalizedText(item.channel_title);
  return subscriptions.filter((row) => (
    Boolean(item.channel_id && row.channel_id && item.channel_id === row.channel_id)
    || Boolean(channelName && channelName === normalizedText(row.channel_title))
  ));
}

function subscriptionForTopicRef(
  provenanceRef: string,
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
): ReturnType<typeof listYoutubeV2Subscriptions>[number] | null {
  if (!provenanceRef.startsWith('subscription:')) return null;
  const key = provenanceRef.slice('subscription:'.length);
  if (!key) return null;
  return subscriptions.find((row) => row.channel_key === key || row.channel_id === key) ?? null;
}

function provenanceFor(
  candidate: RankedCandidate,
  allowed: readonly YoutubeV2Provenance[],
  anchorById: ReadonlyMap<string, WatchAnchor>,
): YoutubeV2CandidateProvenance | null {
  return candidate.rows
    .filter((row) => allowed.includes(row.provenance))
    .sort((left, right) => {
      const leftWeight = anchorById.get(left.provenance_ref)?.decayed_strength ?? 1;
      const rightWeight = anchorById.get(right.provenance_ref)?.decayed_strength ?? 1;
      return rightWeight - leftWeight
        || right.acquired_at - left.acquired_at
        || left.provenance_ref.localeCompare(right.provenance_ref);
    })[0] ?? null;
}

function rankCandidates(
  provenance: YoutubeV2CandidateProvenance[],
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  excludedIds: Set<string>,
): RankedCandidate[] {
  const anchorById = new Map(watches.map((watch) => [watch.id, watch] as const));
  const grouped = new Map<string, YoutubeV2CandidateProvenance[]>();
  for (const row of provenance) {
    const item = row.item;
    if (item.kind !== 'video' || excludedIds.has(item.id) || isShort(item)) continue;
    if (row.provenance === 'subscription_live') {
      if (!isLive(item)) continue;
    } else if (isLiveLike(item)) {
      continue;
    }
    if (row.provenance.startsWith('subscription_')) {
      const ref = normalizedText(row.provenance_ref);
      const matches = matchingSubscriptions(item, subscriptions);
      if (!matches.some((subscription) => (
        subscription.channel_key === row.provenance_ref
        || subscription.channel_id === row.provenance_ref
        || normalizedText(subscription.channel_title) === ref
      ))) continue;
    } else if (row.provenance === 'history_topic' && row.provenance_ref.startsWith('subscription:')) {
      if (!subscriptionForTopicRef(row.provenance_ref, subscriptions)) continue;
    } else {
      const anchor = anchorById.get(row.provenance_ref);
      if (!anchor) continue;
      if (row.provenance === 'history_channel') {
        const sameId = Boolean(anchor.channel_id && item.channel_id && anchor.channel_id === item.channel_id);
        const sameName = Boolean(
          anchor.channel_title
          && item.channel_title
          && normalizedText(anchor.channel_title) === normalizedText(item.channel_title),
        );
        if ((anchor.channel_id || anchor.channel_title) && !sameId && !sameName) continue;
      }
    }
    const rows = grouped.get(item.id) ?? [];
    rows.push(row);
    grouped.set(item.id, rows);
  }

  const historyMass = watches.length > 0 ? 0.6 : 0;
  const subscriptionMass = subscriptions.length > 0 ? 0.4 : 0;
  const mass = historyMass + subscriptionMass || 1;
  const scoreRows = (rows: YoutubeV2CandidateProvenance[]): RankedCandidate => {
    const item = rows[0]!.item;
    const historyRefs = new Set(rows
      .filter((row) => row.provenance.startsWith('history_') && !row.provenance_ref.startsWith('subscription:'))
      .map((row) => row.provenance_ref));
    const historyMassValue = [...historyRefs]
      .reduce((sum, ref) => sum + (anchorById.get(ref)?.decayed_strength ?? 0), 0);
    const historyAffinity = Math.min(WATCH_PER_VIDEO_STRENGTH_CAP, historyMassValue);
    const subscriptionAffinity = rows.some((row) => (
      row.provenance.startsWith('subscription_')
      || (row.provenance === 'history_topic' && Boolean(subscriptionForTopicRef(row.provenance_ref, subscriptions)))
    )) ? 1 : 0;
    const blend = (
      historyMass * historyAffinity
      + subscriptionMass * subscriptionAffinity
    ) / mass;
    const acquisitionTieBreak = Math.max(...rows.map((row) => row.acquired_at)) / 1e16;
    return {
      item,
      rows,
      history_affinity: historyAffinity,
      subscription_affinity: subscriptionAffinity,
      score: blend + acquisitionTieBreak,
    };
  };
  return [...grouped.values()].map(scoreRows)
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));
}

function prioritizeCreatorDiversity(candidates: RankedCandidate[]): RankedCandidate[] {
  const first: RankedCandidate[] = [];
  const rest: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const creator = creatorKey(candidate.item);
    if (seen.has(creator)) rest.push(candidate);
    else {
      seen.add(creator);
      first.push(candidate);
    }
  }
  return [...first, ...rest];
}

function publishedTimestamp(item: YoutubeItem): number {
  const timestamp = item.published_at ? Date.parse(item.published_at) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function generationInputs(
  provenance: YoutubeV2CandidateProvenance[],
  watches: WatchAnchor[],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
  excludedIds: Set<string>,
  topicSeed: YoutubeV2TopicSeed | null,
): YoutubeV2GenerationItemInput[] {
  const anchorById = new Map(watches.map((watch) => [watch.id, watch] as const));
  const subscribedChannels = new Set(subscriptions.flatMap((row) => row.channel_id ? [row.channel_id] : []));
  const subscribedNames = new Set(subscriptions.map((row) => normalizedText(row.channel_title)).filter(Boolean));
  const candidates = rankCandidates(provenance, watches, subscriptions, excludedIds);

  // Recompute a lane-local score after provenance filtering. Otherwise a row
  // acquired for Beyond could inflate a More Like item (or vice versa) even
  // though that row is not valid provenance for the lane being published.
  const scoreWithRows = (
    candidate: RankedCandidate,
    rows: YoutubeV2CandidateProvenance[],
  ): RankedCandidate => {
    const historyMass = watches.length > 0 ? 0.6 : 0;
    const subscriptionMass = subscriptions.length > 0 ? 0.4 : 0;
    const mass = historyMass + subscriptionMass || 1;
    const historyRefs = new Set(rows
      .filter((row) => row.provenance.startsWith('history_') && !row.provenance_ref.startsWith('subscription:'))
      .map((row) => row.provenance_ref));
    const historyAffinity = Math.min(WATCH_PER_VIDEO_STRENGTH_CAP, [...historyRefs]
      .reduce((sum, ref) => sum + (anchorById.get(ref)?.decayed_strength ?? 0), 0));
    const subscriptionAffinity = rows.some((row) => (
      row.provenance.startsWith('subscription_')
      || (row.provenance === 'history_topic' && Boolean(subscriptionForTopicRef(row.provenance_ref, subscriptions)))
    )) ? 1 : 0;
    const acquisitionTieBreak = Math.max(...rows.map((row) => row.acquired_at)) / 1e16;
    return {
      ...candidate,
      rows,
      history_affinity: historyAffinity,
      subscription_affinity: subscriptionAffinity,
      score: (historyMass * historyAffinity + subscriptionMass * subscriptionAffinity) / mass
        + acquisitionTieBreak,
    };
  };

  const forYou = candidates.filter((candidate) => !isLiveLike(candidate.item));
  const fromSubscriptions = prioritizeCreatorDiversity(candidates.filter((candidate) => (
    !isLiveLike(candidate.item)
    && candidate.rows.some((row) => row.provenance === 'subscription_upload')
  )).sort((left, right) => (
    publishedTimestamp(right.item) - publishedTimestamp(left.item)
    || Math.max(...right.rows.map((row) => row.acquired_at))
      - Math.max(...left.rows.map((row) => row.acquired_at))
    || left.item.id.localeCompare(right.item.id)
  )));
  const live = prioritizeCreatorDiversity(candidates.filter((candidate) => (
    isLive(candidate.item)
    && candidate.rows.some((row) => row.provenance === 'subscription_live')
  )));
  const moreLike = topicSeed
    ? prioritizeCreatorDiversity(candidates.filter((candidate) => {
        if (isLiveLike(candidate.item)) return false;
        if (topicSeed.kind === 'history') {
          return candidate.rows.some((row) => (
            row.provenance_ref === topicSeed.provenance_ref
            && row.provenance.startsWith('history_')
            && !row.source_generation.startsWith('beyond:')
          ));
        }
        const subscriptionKey = topicSeed.provenance_ref.slice('subscription:'.length);
        return candidate.rows.some((row) => (
          (row.provenance === 'history_topic'
            && row.provenance_ref === topicSeed.provenance_ref
            && !row.source_generation.startsWith('beyond:'))
          || (row.provenance === 'subscription_upload'
            && (row.provenance_ref === subscriptionKey || row.provenance_ref === topicSeed.item.channel_id))
        ));
      }).sort((left, right) => {
        const direct = (candidate: RankedCandidate): boolean => candidate.rows.some((row) => (
          topicSeed.kind === 'history'
            ? row.provenance === 'history_channel' && row.provenance_ref === topicSeed.provenance_ref
            : row.provenance === 'subscription_upload'
              && (row.provenance_ref === topicSeed.provenance_ref.slice('subscription:'.length)
                || row.provenance_ref === topicSeed.item.channel_id)
        ));
        return Number(direct(right)) - Number(direct(left))
          || right.score - left.score
          || left.item.id.localeCompare(right.item.id);
      }))
    : [];
  const beyond = prioritizeCreatorDiversity(candidates.filter((candidate) => {
    if (isLiveLike(candidate.item)) return false;
    if (!candidate.rows.some((row) => (
      row.provenance === 'history_topic' && !row.source_generation.startsWith('more_like:')
    ))) return false;
    if (candidate.item.channel_id && subscribedChannels.has(candidate.item.channel_id)) return false;
    const channelName = normalizedText(candidate.item.channel_title);
    return !channelName || !subscribedNames.has(channelName);
  }));

  const output: YoutubeV2GenerationItemInput[] = [];
  const addRail = (
    railId: YoutubeV2GenerationItemInput['rail_id'],
    rows: RankedCandidate[],
    allowed: readonly YoutubeV2Provenance[],
    contextId = '',
  ) => {
    for (const candidate of rows.slice(0, V2_RESERVE_LIMIT)) {
      const source = provenanceFor(candidate, allowed, anchorById);
      if (!source) continue;
      output.push({
        rail_id: railId,
        item: candidate.item,
        score: candidate.score,
        reason: `youtube_v2:${source.provenance}`,
        provenance: source.provenance,
        provenance_ref: source.provenance_ref,
        source_expires_at: source.expires_at,
        context_id: contextId,
      });
    }
  };
  const beyondForLane = prioritizeCreatorDiversity(beyond.map((candidate) => scoreWithRows(
    candidate,
    candidate.rows.filter((row) => !row.source_generation.startsWith('more_like:')),
  )).sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id)));
  const directMoreLike = (candidate: RankedCandidate): boolean => Boolean(topicSeed && candidate.rows.some((row) => (
    topicSeed.kind === 'history'
      ? row.provenance === 'history_channel' && row.provenance_ref === topicSeed.provenance_ref
      : row.provenance === 'subscription_upload'
        && (row.provenance_ref === topicSeed.provenance_ref.slice('subscription:'.length)
          || row.provenance_ref === topicSeed.item.channel_id)
  )));
  const moreLikeForLane = prioritizeCreatorDiversity(moreLike.map((candidate) => scoreWithRows(
    candidate,
    candidate.rows.filter((row) => !row.source_generation.startsWith('beyond:')),
  )).sort((left, right) => (
    Number(directMoreLike(right)) - Number(directMoreLike(left))
    || right.score - left.score
    || left.item.id.localeCompare(right.item.id)
  )));
  addRail('beyond', beyondForLane, ['history_topic']);
  addRail(
    'more_like',
    moreLikeForLane,
    topicSeed?.kind === 'subscription'
      ? ['subscription_upload', 'history_topic']
      : ['history_channel', 'history_topic'],
    topicSeed?.provenance_ref ?? '',
  );
  addRail('new_from_subscriptions', fromSubscriptions, ['subscription_upload']);
  addRail('live_now', live, ['subscription_live']);
  addRail('for_you', forYou, ['history_channel', 'history_topic', 'subscription_upload']);
  return output;
}

export function rebuildYoutubeV2Generation(options: { force?: boolean; at?: number } = {}): YoutubeV2Generation | null {
  const at = options.at ?? Date.now();
  const watches = householdWatchAnchors(at);
  const subscriptions = authoritativeSubscriptions();
  const provenance = listYoutubeV2CandidateProvenance({ at, limit: V2_PROVENANCE_LIMIT });
  const watchedIds = allHouseholdHistoryIds();
  const savedIds = householdSavedIds();
  const blockedIds = householdBlockedIds();
  const topicSeed = topicSeedFromSources(watches, subscriptions, provenance, at);
  const sourceHash = stableSourceHash(
    watches,
    subscriptions,
    provenance,
    watchedIds,
    savedIds,
    blockedIds,
    topicSeed,
    at,
  );
  const latestRecord = latestYoutubeV2GenerationRecord();
  if (!options.force
    && latestRecord?.source_hash === sourceHash
    && latestRecord.model_version === YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION) {
    return latestRecord.status === 'ready' ? latestYoutubeV2Generation() : null;
  }
  const excludedIds = new Set([...watchedIds, ...savedIds, ...blockedIds]);
  const candidates = (watches.length === 0 && subscriptions.length === 0)
    ? []
    : generationInputs(provenance, watches, subscriptions, excludedIds, topicSeed);
  const generation = publishYoutubeV2Generation({
    model_version: YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
    source_hash: sourceHash,
    watch_count: watches.length,
    subscription_count: subscriptions.length,
    items: candidates,
    generated_at: at,
  });
  setYoutubeState('youtube_v2_last_generation', {
    generation,
    status: candidates.length > 0 ? 'ready' : 'empty',
    watch_count: watches.length,
    subscription_count: subscriptions.length,
    active_provenance_count: provenance.length,
    candidate_count: candidates.length,
    generated_at: at,
  });
  return latestYoutubeV2Generation();
}

function stableHash(value: string): number {
  const digest = createHash('sha256').update(value).digest();
  return digest.readUInt32BE(0);
}

function shuffled<T extends { id: string }>(items: T[], seed: string): T[] {
  return [...items].sort((left, right) => (
    stableHash(`${seed}:${left.id}`) - stableHash(`${seed}:${right.id}`)
    || left.id.localeCompare(right.id)
  ));
}

const V2_LABELS: Record<string, string> = {
  for_you: 'For You',
  beyond: 'Beyond Your Subscriptions',
  more_like: 'More Like',
  new_from_subscriptions: 'From Your Subscriptions',
  live_now: 'Live Now',
};
const V2_SUBSCRIPTION_MORE_LABEL = 'More from channels you follow';

function selectWithCreatorCap(
  pool: YoutubeRailItem[],
  seen: ReadonlySet<string>,
  limit: number,
  creatorCap: number,
  relaxCap: boolean,
): YoutubeRailItem[] {
  const eligible = pool.filter((item) => !seen.has(item.id));
  const select = (cap: number): YoutubeRailItem[] => {
    const selected: YoutubeRailItem[] = [];
    const creators = new Map<string, number>();
    for (const item of eligible) {
      const creator = creatorKey(item);
      if ((creators.get(creator) ?? 0) >= cap) continue;
      selected.push(item);
      creators.set(creator, (creators.get(creator) ?? 0) + 1);
      if (selected.length >= limit) break;
    }
    return selected;
  };
  const strict = select(creatorCap);
  if (strict.length >= limit || !relaxCap) return strict;
  let best = strict;
  for (let cap = creatorCap + 1; cap <= limit; cap += 1) {
    const relaxed = select(cap);
    if (relaxed.length > best.length) best = relaxed;
    if (relaxed.length >= limit) return relaxed;
  }
  return best;
}

function generationEntryIsCurrentlyEligible(
  entry: NonNullable<ReturnType<typeof latestYoutubeV2Generation>>['items'][number],
  subscriptions: ReturnType<typeof listYoutubeV2Subscriptions>,
): boolean {
  if (entry.kind !== 'video' || isShort(entry)) return false;
  if (entry.rail_id === 'live_now') {
    if (entry.provenance !== 'subscription_live' || !isLive(entry)) return false;
  } else if (isLiveLike(entry)) {
    return false;
  }
  if (entry.provenance === 'subscription_upload' || entry.provenance === 'subscription_live') {
    const matches = matchingSubscriptions(entry, subscriptions);
    return matches.some((subscription) => (
      subscription.channel_key === entry.provenance_ref
      || subscription.channel_id === entry.provenance_ref
    ));
  }
  if (entry.provenance === 'history_topic' && entry.provenance_ref.startsWith('subscription:')) {
    return subscriptionForTopicRef(entry.provenance_ref, subscriptions) !== null;
  }
  return true;
}

export function youtubeV2RecommendationRails(input: {
  shuffle_epoch: number;
  blocked_ids?: ReadonlySet<string>;
  reserved_ids?: ReadonlySet<string>;
}): YoutubeRail[] {
  const generation = latestYoutubeV2Generation();
  if (!generation) return [];
  const subscriptions = authoritativeSubscriptions();
  const sourceStale = youtubeV2SourceStaleState();
  const blocked = youtubeV2ExactExcludedIds();
  input.blocked_ids?.forEach((id) => blocked.add(id));
  const seen = new Set(input.reserved_ids ?? []);
  const servingAt = Date.now();
  const stale = generation.generated_at < servingAt - loadYoutubeConfig().stale_after_ms
    || sourceStale.stale;
  const selected = new Map<string, YoutubeRail>();
  // Allocate direct-source semantics before discovery so a subscription upload
  // cannot be consumed by a fallback More Like row before its own rail. Display
  // order is applied separately below.
  const allocationOrder = [
    { id: 'new_from_subscriptions', cap: 1, relax: true, live: false },
    { id: 'live_now', cap: 1, relax: true, live: true },
    { id: 'beyond', cap: 1, relax: false, live: false },
    { id: 'more_like', cap: 1, relax: true, live: false },
    { id: 'for_you', cap: 2, relax: false, live: false },
  ] as const;
  for (const spec of allocationOrder) {
    const entries = generation.items
      .filter((entry) => (
        entry.rail_id === spec.id
        && (entry.source_expires_at > servingAt
          // OAuth/source loss keeps a visibly stale, non-live last-good couch
          // snapshot. Live can never outlive its verification window.
          || (sourceStale.stale && entry.rail_id !== 'live_now'))
        && !blocked.has(entry.id)
        && generationEntryIsCurrentlyEligible(entry, subscriptions)
      ));
    let pool = entries
      .map((entry): YoutubeRailItem => ({ ...entry, score: entry.score, reason: entry.reason }));
    if (input.shuffle_epoch > 0) {
      if (spec.id === 'more_like') {
        const subscriptionFallback = entries.some((entry) => entry.context_id.startsWith('subscription:'));
        const sameChannel = shuffled(
          entries.filter((entry) => subscriptionFallback
            ? entry.provenance === 'subscription_upload'
            : entry.provenance === 'history_channel'),
          `${generation.generation}:${input.shuffle_epoch}:${spec.id}:channel`,
        ).map((entry): YoutubeRailItem => ({ ...entry, score: entry.score, reason: entry.reason }));
        const thematic = shuffled(
          entries.filter((entry) => entry.provenance === 'history_topic'),
          `${generation.generation}:${input.shuffle_epoch}:${spec.id}:topic`,
        ).map((entry): YoutubeRailItem => ({ ...entry, score: entry.score, reason: entry.reason }));
        pool = sameChannel.length > 0
          ? [sameChannel[0]!, ...thematic, ...sameChannel.slice(1)]
          : thematic;
      } else {
        pool = shuffled(pool, `${generation.generation}:${input.shuffle_epoch}:${spec.id}`);
      }
    }
    const limit = spec.live ? Math.min(YOUTUBE_RAIL_LIMIT, pool.length) : YOUTUBE_RAIL_LIMIT;
    const items = selectWithCreatorCap(pool, seen, limit, spec.cap, spec.relax);
    if ((!spec.live && items.length !== YOUTUBE_RAIL_LIMIT) || (spec.live && items.length === 0)) continue;
    items.forEach((item) => seen.add(item.id));
    selected.set(spec.id, {
      rail_id: spec.id,
      label: spec.id === 'more_like' && entries.some((entry) => entry.context_id.startsWith('subscription:'))
        ? V2_SUBSCRIPTION_MORE_LABEL
        : V2_LABELS[spec.id],
      items,
      reserve_items: pool,
      candidate_context_id: generation.items.find((entry) => entry.rail_id === spec.id)?.context_id ?? '',
      cached: true,
      stale,
    });
  }
  return ['for_you', 'beyond', 'more_like', 'new_from_subscriptions', 'live_now']
    .map((railId) => selected.get(railId))
    .filter((rail): rail is YoutubeRail => Boolean(rail));
}

export function youtubeV2Diagnostics(): Record<string, unknown> {
  const generation = latestYoutubeV2GenerationRecord();
  const sourceStale = youtubeV2SourceStaleState();
  const ready = generation?.status === 'ready' ? latestYoutubeV2Generation() : null;
  const subscriptions = authoritativeSubscriptions();
  const activeProvenance = listYoutubeV2CandidateProvenance({ limit: V2_PROVENANCE_LIMIT });
  const takeout = latestYoutubeV2TakeoutImport();
  const reserveDepths = Object.fromEntries([
    'for_you', 'beyond', 'more_like', 'new_from_subscriptions', 'live_now',
  ].map((railId) => [railId, ready?.items.filter((item) => item.rail_id === railId).length ?? 0]));
  const watches = householdWatchAnchors();
  return {
    mode: youtubeRecommendationsV2Mode(),
    model_version: YOUTUBE_RECOMMENDATIONS_V2_MODEL_VERSION,
    status: sourceStale.stale && generation?.status === 'ready' ? 'stale' : generation?.status ?? 'setup',
    setup_required: !generation || generation.status === 'empty',
    generation: generation?.generation ?? null,
    generated_at: generation?.generated_at ?? null,
    candidate_count: generation?.candidate_count ?? 0,
    reserve_depths: reserveDepths,
    sources: {
      meaningful_history: watches.length,
      mango_history: watches.filter((watch) => watch.source === 'mango').length,
      takeout_history: watches.filter((watch) => watch.source === 'takeout').length,
      mixed_history: watches.filter((watch) => watch.source === 'mixed').length,
      subscriptions: subscriptions.length,
    },
    blend: {
      history: watches.length > 0 ? 0.6 : 0,
      subscriptions: subscriptions.length > 0 ? 0.4 : 0,
      watch_half_life_days: WATCH_HALF_LIFE_DAYS,
      local_partial_strength: LOCAL_PARTIAL_STRENGTH,
      local_completion_strength: LOCAL_COMPLETION_STRENGTH,
      takeout_strength: TAKEOUT_STRENGTH,
    },
    provenance: youtubeV2CandidateProvenanceSummary(),
    expiry_ms: {
      candidate: YOUTUBE_V2_CANDIDATE_TTL_MS,
      live: YOUTUBE_V2_LIVE_TTL_MS,
    },
    caps: {
      reserve_per_rail: V2_RESERVE_LIMIT,
      beyond_creator_per_row: 1,
      subscriptions_creator_per_row: 1,
      for_you_creator_per_row: 2,
    },
    daily_topic_seed: getYoutubeState<PersistedTopicSeed | null>('youtube_v2_daily_topic_seed', null),
    revisions: {
      published_generation: generation?.generation ?? null,
      published_source_hash: generation?.source_hash ?? null,
      subscription_generations: [...new Set(subscriptions.map((row) => row.source_generation))].sort(),
      history_generation: takeout?.generation ?? null,
      candidate_generations: [...new Set(activeProvenance.map((row) => row.source_generation))].sort(),
    },
    latest_takeout_import: takeout,
    subscription_acquisition: getYoutubeState<unknown>('youtube_v2_subscription_acquisition', null),
    history_metadata: getYoutubeState<unknown>('youtube_v2_history_metadata', null),
    history_acquisition: getYoutubeState<unknown>('youtube_v2_history_acquisition', null),
    live_acquisition: getYoutubeState<unknown>('youtube_v2_live_acquisition', null),
    phase_results: getYoutubeState<unknown>('last_phase_results', []),
    source_stale: sourceStale,
    last_error: getYoutubeState<unknown>('youtube_v2_last_error', null),
  };
}

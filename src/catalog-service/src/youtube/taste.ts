import {
  listMeaningfulYoutubeWatchEventsPage,
  listProfileLibraryFeedback,
} from '../library/db.js';
import {
  getYoutubeItem,
  listYoutubeV2ImportedHistory,
} from './db.js';

export const WATCH_HALF_LIFE_DAYS = 90;
export const TAKEOUT_STRENGTH = 0.55;
export const LOCAL_WATCH_STRENGTH = TAKEOUT_STRENGTH;
export const WATCH_PER_VIDEO_STRENGTH_CAP = 3;
export const CHANNEL_PENALTY_HALF_LIFE_DAYS = 60;
export const CHANNEL_PENALTY_PER_EVENT = 0.6;
export const CHANNEL_PENALTY_FLOOR = 0.25;
const DAY_MS = 24 * 60 * 60 * 1000;
const V2_WATCH_LIMIT = 5_000;
const V2_EXCLUSION_PAGE_SIZE = 1_000;

export type YoutubeWatchSource = 'takeout' | 'local' | 'mixed';

export type YoutubeWatchAnchor = {
  id: string;
  title: string;
  channel_id: string | null;
  channel_title: string | null;
  watched_at: number;
  base_strength: number;
  decayed_strength: number;
  event_count: number;
  event_times: number[];
  source: YoutubeWatchSource;
};

export type YoutubeScoringVariant = 'legacy' | 'v3' | 'v3-embed';

export function youtubeScoringVariant(
  raw = process.env.MANGO_YOUTUBE_SCORING,
): YoutubeScoringVariant {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'legacy' || normalized === 'v2.7') return 'legacy';
  if (normalized === 'v3-embed' || normalized === 'v3_embed') return 'v3-embed';
  return 'v3';
}

export function decayedWatchStrength(base: number, watchedAt: number, at: number): number {
  const ageDays = Math.max(0, (at - watchedAt) / DAY_MS);
  return base * (0.5 ** (ageDays / WATCH_HALF_LIFE_DAYS));
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

export function youtubeCreatorKey(input: {
  id?: string;
  channel_id?: string | null;
  channel_title?: string | null;
}): string {
  return input.channel_id?.trim()
    || normalizedText(input.channel_title)
    || (input.id ? `video:${input.id}` : '');
}

function mergeWatchSource(left: YoutubeWatchSource, right: YoutubeWatchSource): YoutubeWatchSource {
  if (left === right) return left;
  return 'mixed';
}

export function householdWatchAnchors(options: {
  at?: number;
  watchUntil?: number;
  includeLocal?: boolean;
} = {}): YoutubeWatchAnchor[] {
  const at = options.at ?? Date.now();
  const watchUntil = options.watchUntil ?? at;
  const includeLocal = options.includeLocal !== false;
  const merged = new Map<string, YoutubeWatchAnchor>();
  const addEvent = (anchor: YoutubeWatchAnchor) => {
    if (anchor.watched_at > watchUntil) return;
    const current = merged.get(anchor.id);
    if (!current) {
      merged.set(anchor.id, { ...anchor, event_times: [...anchor.event_times] });
      return;
    }
    if (current.event_times.some((timestamp) => Math.abs(timestamp - anchor.watched_at) <= 60_000)) {
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
      event_count: current.event_count + 1,
      event_times: [...current.event_times, ...anchor.event_times],
      source: mergeWatchSource(current.source, anchor.source),
    });
  };
  for (const row of listYoutubeV2ImportedHistory(V2_WATCH_LIMIT)) {
    if (row.watched_at > watchUntil) continue;
    const cached = getYoutubeItem('video', row.video_id);
    addEvent({
      id: row.video_id,
      title: cached?.title || row.title,
      channel_id: cached?.channel_id || row.channel_id,
      channel_title: cached?.channel_title || row.channel_title,
      watched_at: row.watched_at,
      base_strength: TAKEOUT_STRENGTH,
      decayed_strength: decayedWatchStrength(TAKEOUT_STRENGTH, row.watched_at, at),
      event_count: 1,
      event_times: [row.watched_at],
      source: 'takeout',
    });
  }
  if (includeLocal) {
    let afterHistoryId = 0;
    while (true) {
      const page = listMeaningfulYoutubeWatchEventsPage({
        profile_id: 'household',
        household_blend: false,
        watched_until: watchUntil,
        after_history_id: afterHistoryId,
        limit: V2_EXCLUSION_PAGE_SIZE,
      });
      for (const row of page) {
        const cached = getYoutubeItem('video', row.id);
        addEvent({
          id: row.id,
          title: cached?.title || row.title || row.id,
          channel_id: cached?.channel_id ?? null,
          channel_title: cached?.channel_title ?? null,
          watched_at: row.watched_at,
          base_strength: LOCAL_WATCH_STRENGTH,
          decayed_strength: decayedWatchStrength(LOCAL_WATCH_STRENGTH, row.watched_at, at),
          event_count: 1,
          event_times: [row.watched_at],
          source: 'local',
        });
      }
      if (page.length < V2_EXCLUSION_PAGE_SIZE) break;
      const next = page.at(-1)!.history_id;
      if (next <= afterHistoryId) break;
      afterHistoryId = next;
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.watched_at - left.watched_at || left.id.localeCompare(right.id))
    .slice(0, V2_WATCH_LIMIT);
}

export function channelAffinityMap(watches: readonly YoutubeWatchAnchor[]): Map<string, number> {
  const affinity = new Map<string, number>();
  for (const watch of watches) {
    const key = youtubeCreatorKey(watch);
    if (!key) continue;
    affinity.set(key, Math.min(
      WATCH_PER_VIDEO_STRENGTH_CAP,
      (affinity.get(key) ?? 0) + watch.decayed_strength,
    ));
  }
  return affinity;
}

export function channelAffinityFactor(input: {
  subscriptionBacked: boolean;
  channelStrength: number;
  seedStrength?: number;
  variant?: YoutubeScoringVariant;
}): number {
  const strength = Math.max(0, input.channelStrength, input.seedStrength ?? 0);
  const unit = Math.min(1, strength / WATCH_PER_VIDEO_STRENGTH_CAP);
  if (input.variant === 'legacy') {
    return input.subscriptionBacked ? 1 : 0.6 + 0.4 * unit;
  }
  if (input.subscriptionBacked) return 0.75 + 0.25 * unit;
  return 0.6 + 0.4 * unit;
}

export type YoutubeChannelPenaltyEvent = {
  channel_key: string;
  updated_at: number;
};

export function householdChannelPenaltyEvents(at = Date.now()): YoutubeChannelPenaltyEvent[] {
  const events: YoutubeChannelPenaltyEvent[] = [];
  for (const row of listProfileLibraryFeedback('not_interested', undefined, {
    profile_id: 'household',
    household_blend: false,
  })) {
    if (row.type !== 'youtube_video' && row.type !== 'youtube_channel') continue;
    if (row.updated_at > at) continue;
    const cached = row.type === 'youtube_video' ? getYoutubeItem('video', row.id) : getYoutubeItem('channel', row.id);
    const key = row.type === 'youtube_channel'
      ? youtubeCreatorKey({ id: row.id, channel_id: row.id, channel_title: row.title })
      : youtubeCreatorKey({
        id: row.id,
        channel_id: cached?.channel_id ?? null,
        channel_title: cached?.channel_title || row.title,
      });
    if (!key) continue;
    events.push({ channel_key: key, updated_at: row.updated_at });
  }
  return events;
}

export function channelPenaltyFactor(
  channelKey: string,
  events: readonly YoutubeChannelPenaltyEvent[],
  at: number,
  variant: YoutubeScoringVariant = 'v3',
): number {
  if (variant === 'legacy' || !channelKey) return 1;
  const decayed = events
    .filter((event) => event.channel_key === channelKey)
    .reduce((sum, event) => {
      const ageDays = Math.max(0, (at - event.updated_at) / DAY_MS);
      return sum + (0.5 ** (ageDays / CHANNEL_PENALTY_HALF_LIFE_DAYS));
    }, 0);
  if (decayed <= 0) return 1;
  return Math.max(CHANNEL_PENALTY_FLOOR, CHANNEL_PENALTY_PER_EVENT ** decayed);
}

/** Recency (power-law with exponential cutoff) times decayed frequency. */
export function rewatchScore(anchor: YoutubeWatchAnchor, at: number): number {
  if (anchor.event_times.length < 2) return 0;
  const last = Math.max(...anchor.event_times);
  const ageDays = Math.max(0, (at - last) / DAY_MS);
  const recency = ((ageDays + 1) ** -0.5) * Math.exp(-ageDays / WATCH_HALF_LIFE_DAYS);
  return recency * anchor.decayed_strength;
}

export function topAffinityChannels(
  affinity: ReadonlyMap<string, number>,
  limit = 8,
): string[] {
  return [...affinity.entries()]
    .filter(([key, strength]) => key && strength > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, limit))
    .map(([key]) => key);
}

export type YoutubeItemKind = 'video' | 'channel' | 'playlist';

export type YoutubeLiveStatus = 'none' | 'live' | 'upcoming' | 'completed';

export type YoutubeItem = {
  id: string;
  kind: YoutubeItemKind;
  title: string;
  subtitle: string;
  description: string | null;
  thumbnail: string | null;
  channel_id: string | null;
  channel_title: string | null;
  published_at: string | null;
  duration_sec: number | null;
  live_status: YoutubeLiveStatus;
  playlist_id: string | null;
  updated_at: number;
};

export type YoutubeRailItem = YoutubeItem & {
  score: number;
  reason: string | null;
};

export type YoutubeRail = {
  rail_id: string;
  label: string;
  items: YoutubeRailItem[];
  cached: boolean;
  stale: boolean;
  /** Internal-only ranked reserve used for cross-rail dedupe backfill. */
  reserve_items?: YoutubeRailItem[];
  /** Internal-only candidate-state namespace, e.g. a Because-You-Watched seed. */
  candidate_context_id?: string;
};

export type YoutubeSearchGroups = {
  videos: YoutubeItem[];
  channels: YoutubeItem[];
  playlists: YoutubeItem[];
};

export type YoutubeRefreshPhaseResult = {
  phase: string;
  ok: boolean;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  error?: string;
};

export type YoutubeRefreshStatus = {
  last_refresh_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  last_reason: string | null;
  phase_results: YoutubeRefreshPhaseResult[];
  /** Backward-compatible aggregate of locally observed API quota units. */
  quota_used_today: number;
  search_calls_today: number;
  api_calls_today: number;
  quota_reset_day: string;
  quota_budget: number;
  interactive_reserve: number;
  search_call_budget: number;
  interactive_search_call_reserve: number;
  background_remaining: number;
  interactive_remaining: number;
  background_search_calls_remaining: number;
  interactive_search_calls_remaining: number;
};

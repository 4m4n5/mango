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
  quota_used_today: number;
  quota_reset_day: string;
};

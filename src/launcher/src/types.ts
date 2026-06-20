export interface ApiInfo {
  hostname: string;
  ip: string;
  launcher_port: number;
  companion_port: number;
  fallback_stremio: boolean;
  legacy_youtube: boolean;
}

export type LaunchAction = "stremio" | "kodi";
export type TileAction = LaunchAction | "settings";
export type BrowseTab = "movies" | "series";

export type RefreshLevelId =
  | "shuffle_rails"
  | "stale_refresh"
  | "topup_low_rails"
  | "full_maintenance";

export interface ContentCard {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  posterUrl?: string;
  year?: number | string;
  description?: string;
  source?: string;
  railId?: string;
  /** Stremio play id — episode id when resuming series. */
  playId?: string;
  resumeSec?: number;
  progressPct?: number;
}

export interface ContentRail {
  id: string;
  label: string;
  cards: ContentCard[];
}

export interface AppCard {
  id: string;
  action: TileAction;
  kicker: string;
  title: string;
}

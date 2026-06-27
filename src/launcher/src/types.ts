export interface ApiInfo {
  hostname: string;
  ip: string;
  launcher_port: number;
  companion_port: number;
}

export type TileAction = "settings";
export type BrowseTab = "movies" | "series" | "live" | "youtube";

export type RefreshLevelId =
  | "shuffle_rails"
  | "stale_refresh"
  | "grow_quick"
  | "grow_nightly"
  | "grow_overnight"
  | "quick_topup"
  | "topup_low_rails"
  | "full_maintenance"
  | "growth_pass"
  | "overnight_grow";

export type RefreshLevelCategory = "instant" | "quick" | "standard" | "overnight";

export interface ContentCard {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  posterUrl?: string;
  year?: number | string;
  description?: string;
  source?: string;
  kind?: "video" | "channel" | "playlist";
  liveStatus?: "none" | "live" | "upcoming" | "completed";
  detailItems?: ContentCard[];
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

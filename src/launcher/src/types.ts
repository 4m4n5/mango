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
  /** Durable library identity; playback `source` remains transport-owned. */
  librarySource?: string;
  source?: string;
  kind?: "video" | "channel" | "playlist";
  liveStatus?: "none" | "live" | "upcoming" | "completed";
  detailItems?: ContentCard[];
  railId?: string;
  /** Version of the recommendation slate that placed this card. */
  slateSequence?: number;
  /** Opaque server-issued proof of the exact rendered slate and profile owner. */
  attributionToken?: string;
  /** Stremio play id — episode id when resuming series. */
  playId?: string;
  resumeSec?: number;
  progressPct?: number;
  /** Verify-state surfaced from voice search / detail meta — additive, optional. */
  inLibrary?: boolean;
  queuedForVerify?: boolean;
}

export interface ContentRail {
  id: string;
  label: string;
  cards: ContentCard[];
  layout?: "landscape" | "poster";
  /** Idempotency/version token for rendered-card impression telemetry. */
  slateSequence?: number;
  attributionToken?: string;
  /** Upstream/cache sequence used only by domain-specific exposure accounting. */
  sourceSlateSequence?: number;
}

export interface AppCard {
  id: string;
  action: TileAction;
  kicker: string;
  title: string;
}

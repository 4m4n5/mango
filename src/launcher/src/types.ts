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

export interface ContentCard {
  id: string;
  title: string;
  subtitle: string;
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

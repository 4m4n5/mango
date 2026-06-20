import type { ContentCard, ContentRail } from "./types";
import { couchSafeCatalogMessage } from "./catalog-errors";
import type { BrowseTab } from "./types";

interface RailSummaryResponse {
  rails: Array<{
    id: string;
    label: string;
    type: "addon_catalog" | "composite_list";
    content_type: string;
    sources: Array<{ addon: string; catalog: string; weight: number }>;
  }>;
}

interface RailItemsResponse {
  rail_id: string;
  label?: string;
  items: Array<{
    id: string;
    type: string;
    title: string;
    subtitle?: string;
    poster: string;
    year?: number | string;
    description?: string;
    source?: string;
    progress?: {
      play_id: string;
      position_sec: number;
      duration_sec: number;
      progress_pct: number;
    };
  }>;
  resolve_ms?: number;
}

interface TabRailItemsResponse {
  tab: BrowseTab;
  rails: RailItemsResponse[];
  resolve_ms?: number;
}

export interface CatalogMeta {
  id: string;
  type: string;
  name?: string;
  title?: string;
  year?: number | string;
  poster?: string;
  description?: string;
  releaseInfo?: string;
  runtime?: string;
}

export interface PlayResult {
  ok: boolean;
  ttff_ms?: number;
  total_ms?: number;
  attempts?: number;
  stream?: {
    source?: string;
    title?: string;
    quality?: string;
    display_label?: string;
    resolve_ms?: number;
  };
  error?: string;
}

export interface CatalogStream {
  url: string;
  display_label?: string;
  title?: string;
  name?: string;
  quality?: string;
  languages?: string[];
  source?: string;
}

export interface SeriesEpisodeRow {
  id: string;
  season: number;
  episode: number;
  title: string;
  thumbnail?: string;
  progress_pct: number | null;
  playable: boolean | null;
}

export interface SeriesSeasonBlock {
  season: number;
  label: string;
  episodes: SeriesEpisodeRow[];
}

export interface SeriesEpisodesResponse {
  series_id: string;
  name: string;
  seasons: SeriesSeasonBlock[];
  resume: {
    episode_id: string;
    position_sec: number;
    duration_sec: number;
    progress_pct: number;
  } | null;
  episode_count: number;
}

export interface NextPromptResponse {
  show: boolean;
  series_id?: string;
  series_name?: string;
  from_episode_id?: string;
  progress_pct?: number;
  next?: {
    id: string;
    season: number;
    episode: number;
    title: string;
  };
}

export interface StreamsResult {
  streams: CatalogStream[];
  resolve_ms?: number;
}

function mapRailItems(data: RailItemsResponse): ContentRail {
  return {
    id: data.rail_id,
    label: data.label || data.rail_id,
    cards: data.items.map((item): ContentCard => ({
      id: item.id,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle || (item.year ? String(item.year) : item.type),
      posterUrl: item.poster,
      year: item.year,
      description: item.description,
      source: item.source,
      railId: data.rail_id,
      playId: item.progress?.play_id,
      resumeSec: item.progress?.position_sec,
      progressPct: item.progress?.progress_pct,
    })),
  };
}

export async function loadCatalogRails(
  tab: BrowseTab = "movies",
  options: { reshuffle?: boolean } = {},
): Promise<ContentRail[]> {
  const reshuffle = options.reshuffle ? "&reshuffle=1" : "";
  try {
    const batch = await fetchJson<TabRailItemsResponse>(
      `/api/catalog/rails/items?tab=${encodeURIComponent(tab)}${reshuffle}`,
    );
    return batch.rails.map(mapRailItems);
  } catch {
    // Fallback for older catalog-service builds without tab batch allocation.
    const summary = await fetchJson<RailSummaryResponse>(
      `/api/catalog/rails?tab=${encodeURIComponent(tab)}`,
    );
    const rails: ContentRail[] = [];
    for (const rail of summary.rails) {
      const data = await fetchJson<RailItemsResponse>(
        `/api/catalog/rails/${encodeURIComponent(rail.id)}/items`,
      );
      rails.push(mapRailItems({ ...data, label: data.label || rail.label }));
    }
    return rails;
  }
}

export async function loadMeta(card: ContentCard): Promise<CatalogMeta> {
  return fetchJson<CatalogMeta>(
    `/api/catalog/meta/${encodeURIComponent(card.type)}/${encodeURIComponent(card.id)}`,
  );
}

export async function loadSeriesEpisodes(bareId: string): Promise<SeriesEpisodesResponse> {
  return fetchJson<SeriesEpisodesResponse>(
    `/api/catalog/series/${encodeURIComponent(bareId)}/episodes`,
  );
}

export async function loadNextPrompt(): Promise<NextPromptResponse> {
  return fetchJson<NextPromptResponse>("/api/catalog/play/next-prompt");
}

export async function loadStreamsForId(type: string, id: string): Promise<StreamsResult> {
  return fetchJson<StreamsResult>(
    `/api/catalog/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
  );
}

export async function loadStreams(card: ContentCard, episodeId?: string): Promise<StreamsResult> {
  const streamId = episodeId || card.playId || card.id;
  return loadStreamsForId(card.type, streamId);
}

export async function prefetchStreams(card: ContentCard): Promise<void> {
  await loadStreams(card);
}

export async function cancelPlay(): Promise<void> {
  try {
    await fetch("/api/catalog/play-cancel", { method: "POST" });
  } catch {
    // best-effort — mpv-stop on pad also bumps cancel epoch
  }
}

export async function playCard(
  card: ContentCard,
  options: { signal?: AbortSignal; preferUrl?: string; startSec?: number; episodeId?: string } = {},
): Promise<PlayResult> {
  const playId = options.episodeId || card.playId || card.id;
  const body: {
    type: string;
    id: string;
    rail_id?: string;
    prefer_url?: string;
    start_sec?: number;
    live?: boolean;
  } = {
    type: card.type,
    id: playId,
  };
  if (card.type === "tv") {
    body.live = true;
  }
  if (card.railId) {
    body.rail_id = card.railId;
  }
  if (options.preferUrl) {
    body.prefer_url = options.preferUrl;
  }
  const startSec = options.startSec ?? card.resumeSec;
  if (typeof startSec === 'number' && startSec > 0) {
    body.start_sec = startSec;
  }
  return fetchJson<PlayResult>("/api/catalog/play", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 499) {
      throw new Error("play cancelled");
    }
    const raw = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(couchSafeCatalogMessage(raw));
  }
  return data as T;
}

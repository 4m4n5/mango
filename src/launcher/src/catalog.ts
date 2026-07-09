import type { ContentCard, ContentRail } from "./types";
import { couchSafeCatalogMessage, playErrorMessage, playTimeoutMessage } from "./catalog-errors";
import type { BrowseTab } from "./types";

interface RailSummaryResponse {
  rails: Array<{
    id: string;
    label: string;
    type: "addon_catalog" | "composite_list" | "ai_catalog";
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

interface YoutubeItem {
  id: string;
  kind: "video" | "channel" | "playlist";
  title: string;
  subtitle: string;
  description?: string | null;
  thumbnail?: string | null;
  channel_title?: string | null;
  duration_sec?: number | null;
  live_status?: "none" | "live" | "upcoming" | "completed";
  published_at?: string | null;
}

interface YoutubeRailResponse {
  rails: Array<{
    rail_id: string;
    label: string;
    items: YoutubeItem[];
    cached?: boolean;
    stale?: boolean;
  }>;
  refresh?: {
    last_error?: string | null;
    last_success_at?: number | null;
  };
}

export interface YoutubeDetailResponse {
  item: YoutubeItem;
  items: YoutubeItem[];
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
  /** Verify-state — additive fields from the catalog meta endpoint. */
  in_library?: boolean;
  queued_for_verify?: boolean;
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
    format?: string;
  };
  error?: string;
  /** True on the play that first promotes a title to the verified library. */
  first_time_verified?: boolean;
}

export interface CatalogStream {
  url: string;
  display_label?: string;
  title?: string;
  name?: string;
  quality?: string;
  languages?: string[];
  source?: string;
  ladder_step?: string;
  /** True when side list fell back to obligation-floor (not ladder-verified). */
  unverified?: boolean;
  /** Enrichment fields (catalog-service stream-filters) — used for clean bubbles. */
  resolution?: string;
  release_tier?: string;
  encode?: string;
  hdr_tags?: string[];
  size_gb?: number;
  cache_status?: "cached" | "uncached" | "unknown";
  debrid_service?: string;
}

export interface SeriesEpisodeRow {
  id: string;
  season: number;
  episode: number;
  title: string;
  thumbnail?: string;
  progress_pct: number | null;
  playable?: boolean | null;
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
  default_episode_id: string | null;
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

function youtubeType(item: YoutubeItem): string {
  if (item.kind === "video") {
    return "youtube_video";
  }
  if (item.kind === "channel") {
    return "youtube_channel";
  }
  return "youtube_playlist";
}

function youtubeSubtitle(item: YoutubeItem): string {
  if (item.live_status === "live") {
    return `${item.channel_title || item.subtitle || "YouTube"} · live`;
  }
  if (item.kind === "video") {
    return item.channel_title || item.subtitle || "YouTube";
  }
  return item.kind;
}

function mapYoutubeItem(item: YoutubeItem, railId?: string): ContentCard {
  return {
    id: item.id,
    type: youtubeType(item),
    title: item.title,
    subtitle: youtubeSubtitle(item),
    posterUrl: item.thumbnail || "",
    description: item.description || undefined,
    source: "youtube",
    kind: item.kind,
    liveStatus: item.live_status || "none",
    railId,
  };
}

function mapYoutubeRails(data: YoutubeRailResponse): ContentRail[] {
  return data.rails.map((rail) => ({
    id: rail.rail_id,
    label: rail.stale ? `${rail.label} · stale` : rail.label,
    cards: rail.items.map((item) => mapYoutubeItem(item, rail.rail_id)),
  }));
}

function cardRefKey(card: Pick<ContentCard, "type" | "id">): string {
  return `${card.type}:${card.id}`;
}

function shuffleCards(cards: ContentCard[]): ContentCard[] {
  const output = [...cards];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function buildExcludeParam(homeVisible: ContentCard[], card: ContentCard): string {
  const keys = new Set<string>();
  keys.add(cardRefKey(card));
  for (const visible of homeVisible) {
    keys.add(cardRefKey(visible));
  }
  return [...keys].join(",");
}

function pickRelatedFallback(
  homeVisible: ContentCard[],
  card: ContentCard,
  limit: number,
): ContentCard[] {
  const exclude = new Set([cardRefKey(card)]);
  return shuffleCards(homeVisible.filter((sibling) => !exclude.has(cardRefKey(sibling)))).slice(0, limit);
}

export async function loadRailRelatedCards(
  card: ContentCard,
  homeVisible: ContentCard[],
  tab: BrowseTab,
  limit = 8,
): Promise<ContentCard[]> {
  const railId = card.railId;
  if (!railId) {
    return pickRelatedFallback(homeVisible, card, limit);
  }
  const exclude = buildExcludeParam(homeVisible, card);
  try {
    if (tab === "youtube" || card.source === "youtube") {
      const data = await fetchJson<{ items: YoutubeItem[] }>(
        `/api/catalog/youtube/related?rail_id=${encodeURIComponent(railId)}&exclude=${encodeURIComponent(exclude)}&limit=${limit}`,
        undefined,
        8000,
      );
      const mapped = data.items.map((item) => mapYoutubeItem(item, railId));
      if (mapped.length > 0) {
        return mapped;
      }
    } else {
      const data = await fetchJson<RailItemsResponse>(
        `/api/catalog/rails/${encodeURIComponent(railId)}/related?exclude=${encodeURIComponent(exclude)}&limit=${limit}`,
        undefined,
        8000,
      );
      const mapped = mapRailItems(data).cards;
      if (mapped.length > 0) {
        return mapped;
      }
    }
  } catch {
    // fall through to local shuffle
  }
  return pickRelatedFallback(homeVisible, card, limit);
}

export async function loadCatalogRails(
  tab: BrowseTab = "movies",
  options: { reshuffle?: boolean } = {},
): Promise<ContentRail[]> {
  if (tab === "youtube") {
    const reshuffle = options.reshuffle ? "?reshuffle=1" : "";
    const data = await fetchJson<YoutubeRailResponse>(`/api/catalog/youtube/rails${reshuffle}`, undefined, 15000);
    return mapYoutubeRails(data);
  }
  const reshuffle = tab !== "live" && options.reshuffle ? "&reshuffle=1" : "";
  try {
    const batch = await fetchJson<TabRailItemsResponse>(
      `/api/catalog/rails/items?tab=${encodeURIComponent(tab)}${reshuffle}`,
      undefined,
      12000,
    );
    return batch.rails.map(mapRailItems);
  } catch {
    // Fallback for older catalog-service builds without tab batch allocation.
    const summary = await fetchJson<RailSummaryResponse>(
      `/api/catalog/rails?tab=${encodeURIComponent(tab)}`,
      undefined,
      12000,
    );
    const rails: ContentRail[] = [];
    for (const rail of summary.rails) {
      const data = await fetchJson<RailItemsResponse>(
        `/api/catalog/rails/${encodeURIComponent(rail.id)}/items`,
        undefined,
        12000,
      );
      rails.push(mapRailItems({ ...data, label: data.label || rail.label }));
    }
    return rails;
  }
}

export async function loadContinueRail(tab: BrowseTab): Promise<ContentRail> {
  const data = await fetchJson<RailItemsResponse>(
    `/api/catalog/rails/continue?tab=${encodeURIComponent(tab)}`,
    undefined,
    5000,
  );
  return mapRailItems(data);
}

export async function loadMeta(card: ContentCard): Promise<CatalogMeta> {
  if (card.source === "youtube" || card.type.startsWith("youtube_")) {
    const kind = card.kind || youtubeKindFromType(card.type);
    const detail = await loadYoutubeDetail(card.id, kind);
    const item = detail.item;
    return {
      id: item.id,
      type: youtubeType(item),
      name: item.title,
      title: item.title,
      poster: item.thumbnail || undefined,
      description: item.description || undefined,
      runtime: item.live_status === "live" ? "live" : undefined,
      releaseInfo: item.channel_title || item.subtitle,
    };
  }
  return fetchJson<CatalogMeta>(
    `/api/catalog/meta/${encodeURIComponent(card.type)}/${encodeURIComponent(card.id)}`,
    undefined,
    12000,
  );
}

export async function loadYoutubeDetail(
  id: string,
  kind: YoutubeItem["kind"] = "video",
): Promise<YoutubeDetailResponse> {
  const data = await fetchJson<YoutubeDetailResponse>(
    `/api/catalog/youtube/detail?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
    undefined,
    15000,
  );
  return {
    item: data.item,
    items: (data.items || []),
  };
}

export async function loadYoutubeDetailCards(card: ContentCard): Promise<ContentCard[]> {
  const detail = await loadYoutubeDetail(card.id, card.kind || youtubeKindFromType(card.type));
  return detail.items.map((item) => mapYoutubeItem(item, `youtube:${card.kind || "detail"}:${card.id}`));
}

export async function loadSeriesEpisodes(bareId: string): Promise<SeriesEpisodesResponse> {
  return fetchJson<SeriesEpisodesResponse>(
    `/api/catalog/series/${encodeURIComponent(bareId)}/episodes`,
    undefined,
    12000,
  );
}

export async function loadNextPrompt(): Promise<NextPromptResponse> {
  return fetchJson<NextPromptResponse>("/api/catalog/play/next-prompt", undefined, 5000);
}

export async function loadStreamsForId(type: string, id: string): Promise<StreamsResult> {
  return fetchJson<StreamsResult>(
    `/api/catalog/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    undefined,
    15000,
  );
}

export async function loadStreams(card: ContentCard, episodeId?: string): Promise<StreamsResult> {
  if (card.source === "youtube" || card.type.startsWith("youtube_")) {
    return { streams: [] };
  }
  const streamId = episodeId || card.playId || card.id;
  return loadStreamsForId(card.type, streamId);
}

export async function prefetchStreams(card: ContentCard): Promise<void> {
  await loadStreams(card);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const abortFromSource = (): void => controller.abort();
  if (sourceSignal) {
    if (sourceSignal.aborted) {
      controller.abort();
    } else {
      sourceSignal.addEventListener("abort", abortFromSource, { once: true });
    }
  }
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    sourceSignal?.removeEventListener("abort", abortFromSource);
    window.clearTimeout(timeout);
  }
}

export async function cancelPlay(): Promise<void> {
  try {
    await fetchWithTimeout("/api/catalog/play-cancel", { method: "POST" }, 2500);
  } catch {
    // best-effort — mpv-stop on pad also bumps cancel epoch
  }
}

export async function flushProgress(): Promise<void> {
  try {
    await fetchWithTimeout("/api/catalog/progress/flush", { method: "POST" }, 5000);
  } catch {
    // best-effort — mpv-stop already flushes on stop
  }
}

/** Stop mpv and return focus to the launcher before voice-driven title switches. */
export async function stopPlaybackForVoice(): Promise<void> {
  await cancelPlay();
  try {
    await fetchWithTimeout("/api/playback/stop", { method: "POST" }, 7500);
  } catch {
    // mpv may already be stopped
  }
}

export async function playCard(
  card: ContentCard,
  options: { signal?: AbortSignal; preferUrl?: string; preferLadderStep?: string; startSec?: number; episodeId?: string } = {},
): Promise<PlayResult> {
  if (card.source === "youtube" || card.type === "youtube_video") {
    return fetchPlayJson<PlayResult>("/api/catalog/youtube/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: card.id,
        title: card.title,
        poster: card.posterUrl,
      }),
      signal: options.signal,
    }, 95000);
  }
  const playId = options.episodeId || card.playId || card.id;
  const body: {
    type: string;
    id: string;
    title?: string;
    poster?: string;
    year?: string | number;
    description?: string;
    tab?: string;
    rail_id?: string;
    prefer_url?: string;
    prefer_ladder_step?: string;
    start_sec?: number;
    live?: boolean;
  } = {
    type: card.type,
    id: playId,
    title: card.title,
    poster: card.posterUrl,
    year: card.year,
    description: card.description,
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
  if (options.preferLadderStep) {
    body.prefer_ladder_step = options.preferLadderStep;
  }
  const startSec = options.startSec ?? card.resumeSec;
  if (typeof startSec === 'number' && startSec > 0) {
    body.start_sec = startSec;
  }
  return fetchPlayJson<PlayResult>("/api/catalog/play", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  }, 95000);
}

export async function notInterestedYoutubeCard(card: ContentCard): Promise<void> {
  await fetchJson("/api/catalog/youtube/not-interested", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: card.kind || youtubeKindFromType(card.type),
      id: card.id,
      title: card.title,
    }),
  }, 8000);
}

function youtubeKindFromType(type: string): YoutubeItem["kind"] {
  if (type === "youtube_channel") {
    return "channel";
  }
  if (type === "youtube_playlist") {
    return "playlist";
  }
  return "video";
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const requestInit = {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  };
  try {
    const response = timeoutMs
      ? await fetchWithTimeout(url, requestInit, timeoutMs)
      : await fetch(url, requestInit);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 499) {
        throw new Error("play cancelled");
      }
      const raw = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
      throw new Error(couchSafeCatalogMessage(raw));
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.message === "play cancelled") {
      throw error;
    }
    if (isAbortError(error)) {
      throw new Error(playTimeoutMessage());
    }
    throw error;
  }
}

/** Play endpoints: server already sends couchMessage — pass through unless raw infra. */
async function fetchPlayJson<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const requestInit = {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  };
  try {
    const response = timeoutMs
      ? await fetchWithTimeout(url, requestInit, timeoutMs)
      : await fetch(url, requestInit);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 499) {
        throw new Error("play cancelled");
      }
      const raw = typeof data.error === "string" ? data.error : `HTTP ${response.status}`;
      throw new Error(playErrorMessage(raw));
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.message === "play cancelled") {
      throw error;
    }
    if (isAbortError(error)) {
      throw new Error(playTimeoutMessage());
    }
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || /aborted|AbortError/i.test(error.message);
}

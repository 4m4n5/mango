import type { ContentCard, ContentRail } from "./types";
import {
  CatalogOwnershipChangedError,
  CatalogResponseError,
  CatalogTimeoutError,
  couchSafeCatalogMessage,
  playErrorMessage,
} from "./catalog-errors";
import type { BrowseTab } from "./types";
import {
  personalizationExpectationBody,
  personalizationExpectationParams,
  personalizationOwnerFromPayload,
  samePersonalizationOwner,
  type PersonalizationOwner,
} from "./personalization";
import { recommendationAttributionPayload } from "./recommendation-attribution";

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
  slate_sequence?: number;
  attribution_token?: string;
  profile_id?: string;
  personalization_updated_at?: number;
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
  profile_id?: string;
  personalization_updated_at?: number;
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
  slate_sequence?: number;
  profile_id?: string;
  personalization_updated_at?: number;
  rails: Array<{
    rail_id: string;
    label: string;
    attribution_token?: string;
    slate_sequence?: number;
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

export interface PlayCancelResult {
  ok: boolean;
  cancelled: boolean;
  finished_successfully: boolean;
  epoch: number;
  request_id: string | null;
}

export interface PlaybackSession {
  session_id: string;
  version: number;
  state:
    | "accepted"
    | "resolving"
    | "playing"
    | "stopping"
    | "stopped"
    | "ended"
    | "cancelled"
    | "failed_before_frame"
    | "failed_after_frame";
  ever_ready: boolean;
  error: string | null;
  result: PlayResult | null;
}

interface PlaybackSessionResponse {
  ok: boolean;
  accepted?: boolean;
  session: PlaybackSession;
  profile_id?: string;
  personalization_updated_at?: number;
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
  /** Resume position for this episode only (null/absent = start from beginning). */
  position_sec?: number | null;
  playable?: boolean | null;
  playability_status?: string | null;
  playability_updated_at?: number | null;
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
  profile_id?: string;
  personalization_updated_at?: number;
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
      slateSequence: data.slate_sequence,
      attributionToken: data.attribution_token,
      playId: item.progress?.play_id,
      resumeSec: item.progress?.position_sec,
      progressPct: item.progress?.progress_pct,
    })),
    ...(data.rail_id === "for-you-movies" || data.rail_id === "for-you-series"
      ? { layout: "poster" as const }
      : {}),
    slateSequence: data.slate_sequence,
    attributionToken: data.attribution_token,
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

function mapYoutubeItem(
  item: YoutubeItem,
  railId?: string,
  slateSequence?: number,
  attributionToken?: string,
): ContentCard {
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
    slateSequence,
    attributionToken,
  };
}

function mapYoutubeRails(data: YoutubeRailResponse): ContentRail[] {
  const anchors = new Set(["for_you", "new_from_subscriptions", "history", "saved"]);
  const chosen = [
    ...data.rails.filter((rail) => anchors.has(rail.rail_id)),
    ...data.rails.filter((rail) => !anchors.has(rail.rail_id)).slice(0, 3),
  ];
  return chosen.map((rail) => ({
    id: rail.rail_id,
    label: rail.stale ? `${rail.label} · stale` : rail.label,
    // The catalog service owns cross-rail allocation and has access to deeper
    // reserves. Preserve its stable History/Saved anchors and last-resort thin
    // cache fallbacks instead of thinning rows again in the launcher.
    cards: rail.items.map((item) => mapYoutubeItem(
      item,
      rail.rail_id,
      rail.slate_sequence,
      rail.attribution_token,
    )),
    slateSequence: rail.slate_sequence,
    attributionToken: rail.attribution_token,
    sourceSlateSequence: data.slate_sequence,
  })).filter((rail) => rail.cards.length > 0);
}

export async function noteYoutubeImpressions(rails: ContentRail[]): Promise<void> {
  const sequence = rails.find((rail) => Number.isInteger(rail.sourceSlateSequence))?.sourceSlateSequence;
  if (sequence === undefined) return;
  const rendered = rails
    .map((rail) => ({
      rail_id: rail.id,
      attribution_token: rail.attributionToken,
      slate_revision: rail.slateSequence,
      item_ids: rail.cards.slice(0, 4).map((card) => card.id),
      items: rail.cards.slice(0, 4).map((card, rank) => ({
        type: card.type,
        id: card.id,
        rank,
      })),
    }))
    .filter((rail) => rail.item_ids.length > 0 && rail.attribution_token);
  if (rendered.length === 0) return;
  await fetchJson('/api/catalog/youtube/impressions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slate_sequence: sequence, rails: rendered }),
  }, 3000);
}

export async function noteVodRecommendationImpressions(rails: ContentRail[]): Promise<void> {
  const rendered = rails
    .filter((rail) => Number.isInteger(rail.slateSequence))
    .map((rail) => ({
      rail_id: rail.id,
      slate_revision: rail.slateSequence,
      attribution_token: rail.attributionToken,
      items: rail.cards.slice(0, 6).map((card, rank) => ({ type: card.type, id: card.id, rank })),
    }))
    .filter((rail) => rail.items.length > 0 && rail.attribution_token);
  if (rendered.length === 0) return;
  await fetchJson('/api/catalog/recommendations/impressions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'vod', rails: rendered }),
  }, 3000);
}

export async function noteRecommendationDetailOpen(card: ContentCard): Promise<void> {
  if (!card.railId || !Number.isInteger(card.slateSequence) || !card.attributionToken) return;
  await fetchJson('/api/catalog/recommendations/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'detail_open',
      domain: card.source === 'youtube' || card.type.startsWith('youtube_') ? 'youtube' : 'vod',
      rail_id: card.railId,
      slate_revision: card.slateSequence,
      attribution_token: card.attributionToken,
      recommendation_item_type: card.type,
      recommendation_item_id: card.id,
      type: card.type,
      id: card.id,
    }),
  }, 3000);
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
  options: { reshuffle?: boolean; expectedOwner?: PersonalizationOwner } = {},
): Promise<{ rails: ContentRail[]; owner: PersonalizationOwner | null }> {
  if (tab === "youtube") {
    const params = options.expectedOwner
      ? personalizationExpectationParams(options.expectedOwner)
      : new URLSearchParams();
    if (options.reshuffle) params.set("reshuffle", "1");
    let data: YoutubeRailResponse;
    try {
      data = await fetchJson<YoutubeRailResponse>(
        `/api/catalog/youtube/rails?${params.toString()}`,
        undefined,
        15000,
      );
    } catch (error) {
      if (options.expectedOwner && error instanceof CatalogResponseError && error.status === 409) {
        throw new CatalogOwnershipChangedError();
      }
      throw error;
    }
    const owner = personalizationOwnerFromPayload(data);
    if (!owner || (options.expectedOwner && !samePersonalizationOwner(options.expectedOwner, owner))) {
      throw new CatalogOwnershipChangedError();
    }
    return { rails: mapYoutubeRails(data), owner };
  }
  const params = options.expectedOwner
    ? personalizationExpectationParams(options.expectedOwner)
    : new URLSearchParams();
  params.set("tab", tab);
  if (tab !== "live" && options.reshuffle) params.set("reshuffle", "1");
  try {
    const batch = await fetchJson<TabRailItemsResponse>(
      `/api/catalog/rails/items?${params.toString()}`,
      undefined,
      12000,
    );
    const owner = tab === "live" ? null : personalizationOwnerFromPayload(batch);
    if (tab !== "live"
      && (!owner || (options.expectedOwner && !samePersonalizationOwner(options.expectedOwner, owner)))) {
      throw new CatalogOwnershipChangedError();
    }
    return { rails: batch.rails.map(mapRailItems), owner };
  } catch (error) {
    // An expected owner is a privacy boundary. Never bypass a 409 (or any
    // other strict-batch failure) through legacy endpoints with no owner echo.
    if (options.expectedOwner) {
      if (error instanceof CatalogResponseError && error.status === 409) {
        throw new CatalogOwnershipChangedError();
      }
      throw error;
    }
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
    return { rails, owner: null };
  }
}

export interface ProfileOwnedContinueRail extends PersonalizationOwner {
  rail: ContentRail;
}

export async function loadContinueRail(
  tab: BrowseTab,
  expected: PersonalizationOwner,
): Promise<ProfileOwnedContinueRail> {
  const params = personalizationExpectationParams(expected);
  params.set("tab", tab);
  let data: RailItemsResponse;
  try {
    data = await fetchJson<RailItemsResponse>(
      `/api/catalog/rails/continue?${params.toString()}`,
      undefined,
      5000,
    );
  } catch (error) {
    if (error instanceof CatalogResponseError && error.status === 409) {
      throw new CatalogOwnershipChangedError();
    }
    throw error;
  }
  const owner = personalizationOwnerFromPayload(data);
  if (!owner || !samePersonalizationOwner(expected, owner)) {
    throw new CatalogOwnershipChangedError();
  }
  return {
    rail: mapRailItems(data),
    ...owner,
  };
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

export async function loadNextPrompt(
  expectedOwner: PersonalizationOwner,
): Promise<NextPromptResponse> {
  return fetchOwnedCatalogJson<NextPromptResponse>(
    `/api/catalog/play/next-prompt?${personalizationExpectationParams(expectedOwner)}`,
    undefined,
    5000,
    expectedOwner,
  );
}

export async function loadStreamsForId(
  type: string,
  id: string,
  options: { existingOnly?: boolean; title?: string; year?: string | number } = {},
): Promise<StreamsResult> {
  const params = new URLSearchParams();
  if (options.existingOnly) params.set("existing_only", "1");
  if (options.title?.trim()) params.set("title", options.title.trim());
  if (options.year !== undefined) params.set("year", String(options.year));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<StreamsResult>(
    `/api/catalog/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}${query}`,
    undefined,
    15000,
  );
}

export async function loadStreams(
  card: ContentCard,
  episodeId?: string,
  options: { existingOnly?: boolean } = {},
): Promise<StreamsResult> {
  if (card.source === "youtube" || card.type.startsWith("youtube_")) {
    return { streams: [] };
  }
  const streamId = episodeId || card.playId || card.id;
  return loadStreamsForId(card.type, streamId, {
    ...options,
    title: card.title,
    year: card.year,
  });
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
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    sourceSignal?.removeEventListener("abort", abortFromSource);
    globalThis.clearTimeout(timeout);
  }
}

export async function cancelPlay(requestId?: string): Promise<PlayCancelResult | null> {
  try {
    return await fetchWithTimeout("/api/catalog/play-cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestId ? { request_id: requestId } : {}),
    }, 2500).then(async (response) => {
      if (!response.ok) return null;
      return await response.json() as PlayCancelResult;
    });
  } catch {
    // best-effort — mpv-stop on pad also bumps cancel epoch
    return null;
  }
}

async function cancelPlaybackSession(requestId: string): Promise<void> {
  try {
    await fetchWithTimeout("/api/catalog/play-session/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: requestId }),
    }, 2500);
  } catch {
    await cancelPlay(requestId);
  }
}

export function playbackSessionResult(session: PlaybackSession): PlayResult | null {
  if (session.ever_ready) {
    return session.result ?? { ok: true };
  }
  if (session.state === "cancelled") {
    throw new Error("play cancelled");
  }
  if (session.state === "failed_before_frame" || session.state === "failed_after_frame") {
    throw new Error(session.error || "couldn't start playback. try another title.");
  }
  return null;
}

async function readPlaybackSession(
  requestId: string,
  afterVersion = 0,
  waitMs = 0,
  signal?: AbortSignal,
): Promise<PlaybackSession> {
  const params = new URLSearchParams();
  if (afterVersion > 0) params.set("after", String(afterVersion));
  if (waitMs > 0) params.set("wait_ms", String(waitMs));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetchWithTimeout(
    `/api/catalog/play-session/${encodeURIComponent(requestId)}${query}`,
    { signal },
    Math.max(5000, waitMs + 5000),
  );
  const payload = await response.json().catch(() => ({})) as Partial<PlaybackSessionResponse> & { error?: string };
  if (!response.ok || !payload.session) {
    throw new Error(playErrorMessage(payload.error || `HTTP ${response.status}`));
  }
  return payload.session;
}

async function waitForPlaybackSession(
  requestId: string,
  initial: PlaybackSession,
  signal?: AbortSignal,
): Promise<PlayResult> {
  let session = initial;
  while (true) {
    const result = playbackSessionResult(session);
    if (result) return result;
    if (signal?.aborted) {
      await cancelPlaybackSession(requestId);
      throw new Error("play cancelled");
    }
    try {
      session = await readPlaybackSession(requestId, session.version, 25000, signal);
    } catch (error) {
      if (signal?.aborted) {
        await cancelPlaybackSession(requestId);
        throw new Error("play cancelled");
      }
      // Chromium may thaw after the local long-poll timer and its response both
      // became due. Reconcile authoritative session state before surfacing it.
      try {
        session = await readPlaybackSession(requestId);
        continue;
      } catch {
        throw error;
      }
    }
  }
}

async function startPlaybackSession(
  body: Record<string, unknown>,
  requestId: string,
  expectedOwner: PersonalizationOwner,
  signal?: AbortSignal,
): Promise<PlayResult> {
  if (signal?.aborted) throw new Error("play cancelled");
  let response: Response;
  try {
    response = await fetchWithTimeout("/api/catalog/play-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }, 5000);
  } catch (error) {
    if (signal?.aborted) {
      await cancelPlaybackSession(requestId);
      throw new Error("play cancelled");
    }
    // A slow acknowledgement does not prove rejection. The catalog persists
    // the accepted session before replying, so reconcile by id before failing.
    try {
      const session = await readPlaybackSession(requestId);
      return waitForPlaybackSession(requestId, session, signal);
    } catch {
      throw error;
    }
  }
  const payload = await response.json().catch(() => ({})) as Partial<PlaybackSessionResponse> & { error?: string };
  if (response.status === 409) {
    throw new CatalogOwnershipChangedError();
  }
  if (!response.ok || !payload.session) {
    throw new Error(playErrorMessage(payload.error || `HTTP ${response.status}`));
  }
  assertCatalogResponseOwner(payload, expectedOwner);
  return waitForPlaybackSession(requestId, payload.session, signal);
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
  options: {
    expectedOwner: PersonalizationOwner;
    signal?: AbortSignal;
    preferUrl?: string;
    preferLadderStep?: string;
    startSec?: number;
    episodeId?: string;
  },
): Promise<PlayResult> {
  const requestId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `play-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (card.source === "youtube" || card.type === "youtube_video") {
    return startPlaybackSession({
      request_id: requestId,
      source: "youtube",
      type: "youtube_video",
      id: card.id,
      title: card.title,
      poster: card.posterUrl,
      rail_id: card.railId,
      slate_revision: card.slateSequence,
      attribution_token: card.attributionToken,
      recommendation_item_type: card.type,
      recommendation_item_id: card.id,
      ...personalizationExpectationBody(options.expectedOwner),
    }, requestId, options.expectedOwner, options.signal);
  }
  const playId = options.episodeId || card.playId || card.id;
  const body: {
    request_id: string;
    type: string;
    id: string;
    title?: string;
    poster?: string;
    year?: string | number;
    description?: string;
    tab?: string;
    rail_id?: string;
    slate_revision?: number;
    attribution_token?: string;
    recommendation_item_type?: string;
    recommendation_item_id?: string;
    prefer_url?: string;
    prefer_ladder_step?: string;
    start_sec?: number;
    live?: boolean;
    expected_profile_id: string;
    expected_personalization_updated_at: number;
  } = {
    request_id: requestId,
    type: card.type,
    id: playId,
    title: card.title,
    poster: card.posterUrl,
    year: card.year,
    description: card.description,
    ...personalizationExpectationBody(options.expectedOwner),
  };
  if (card.type === "tv") {
    body.live = true;
  }
  if (card.railId) {
    body.rail_id = card.railId;
  }
  if (Number.isInteger(card.slateSequence)) {
    body.slate_revision = card.slateSequence;
  }
  if (card.attributionToken) {
    body.attribution_token = card.attributionToken;
    body.recommendation_item_type = card.type;
    body.recommendation_item_id = card.id;
  }
  if (options.preferUrl) {
    body.prefer_url = options.preferUrl;
  }
  if (options.preferLadderStep) {
    body.prefer_ladder_step = options.preferLadderStep;
  }
  // Series episode clicks must never inherit the series card's resume timestamp
  // (that belongs to the latest unfinished episode only). Movies / bare-series
  // play still fall back to card.resumeSec when startSec is omitted.
  const startSec = options.episodeId
    ? options.startSec
    : (options.startSec ?? card.resumeSec);
  if (typeof startSec === 'number' && startSec > 0) {
    body.start_sec = startSec;
  }
  return startPlaybackSession(body, requestId, options.expectedOwner, options.signal);
}

export async function notInterestedCard(
  card: ContentCard,
  tab: BrowseTab,
  expectedOwner: PersonalizationOwner,
): Promise<void> {
  const youtube = card.source === "youtube" || card.type.startsWith("youtube_");
  await fetchOwnedCatalogJson("/api/catalog/library/not-interested", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: youtube ? "youtube" : "mango",
      tab,
      type: card.type,
      kind: card.kind || youtubeKindFromType(card.type),
      id: card.id,
      title: card.title,
      poster: card.posterUrl || "",
      year: card.year,
      description: card.description,
      ...recommendationAttributionPayload(card),
      ...personalizationExpectationBody(expectedOwner),
    }),
  }, 8000, expectedOwner);
}

export async function isNotInterestedCard(
  card: ContentCard,
  expectedOwner: PersonalizationOwner,
): Promise<boolean> {
  const youtube = card.source === "youtube" || card.type.startsWith("youtube_");
  const params = personalizationExpectationParams(expectedOwner);
  params.set("source", youtube ? "youtube" : "mango");
  params.set("type", card.type);
  params.set("id", card.id);
  const payload = await fetchOwnedCatalogJson<{
    hidden?: boolean;
    profile_id?: string;
    personalization_updated_at?: number;
  }>(
    `/api/catalog/library/not-interested?${params.toString()}`,
    { cache: "no-store" },
    4000,
    expectedOwner,
  );
  return payload.hidden === true;
}

export async function undoNotInterestedCard(
  card: ContentCard,
  tab: BrowseTab,
  expectedOwner: PersonalizationOwner,
): Promise<void> {
  const youtube = card.source === "youtube" || card.type.startsWith("youtube_");
  await fetchOwnedCatalogJson("/api/catalog/library/not-interested", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: youtube ? "youtube" : "mango",
      tab,
      type: card.type,
      id: card.id,
      title: card.title,
      attribution_token: card.attributionToken,
      rail_id: card.railId,
      slate_revision: card.slateSequence,
      ...personalizationExpectationBody(expectedOwner),
    }),
  }, 8000, expectedOwner);
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
      throw new CatalogResponseError(response.status, couchSafeCatalogMessage(raw));
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.message === "play cancelled") {
      throw error;
    }
    if (isAbortError(error)) {
      throw new CatalogTimeoutError();
    }
    throw error;
  }
}

function assertCatalogResponseOwner(
  payload: { profile_id?: unknown; personalization_updated_at?: unknown },
  expectedOwner: PersonalizationOwner,
): void {
  const responseOwner = personalizationOwnerFromPayload(payload);
  if (!responseOwner || !samePersonalizationOwner(responseOwner, expectedOwner)) {
    throw new CatalogOwnershipChangedError();
  }
}

async function fetchOwnedCatalogJson<T extends {
  profile_id?: unknown;
  personalization_updated_at?: unknown;
}>(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  expectedOwner: PersonalizationOwner,
): Promise<T> {
  let payload: T;
  try {
    payload = await fetchJson<T>(url, init, timeoutMs);
  } catch (error) {
    if (error instanceof CatalogResponseError && error.status === 409) {
      throw new CatalogOwnershipChangedError();
    }
    throw error;
  }
  assertCatalogResponseOwner(payload, expectedOwner);
  return payload;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || /aborted|AbortError/i.test(error.message);
}

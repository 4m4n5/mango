import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  filterAndRankStreams,
  filterStreamsForPlay,
  enrichStreamMetadata,
  loadFilterConfig,
  mergeFilterConfig,
  parseRuntimeMinutes,
  type StreamFilterMeta,
  type StreamFilterOverrides,
  type StreamFilterContext,
} from './stream-filters.js';
import {
  defaultPlayLadder,
  enrichStreams,
  filterStreamsForLadderStep,
} from './play-ladder.js';
import {
  enabledBrowsableRails,
  enabledBrowsableRailsForTab,
  loadRailConfig,
  parseCatalogTab,
  railSourceSummary,
  type BrowsableRail,
  type CatalogTab,
  type RailConfig,
} from './rails.js';
import {
  allocateTabRailSessions,
  getOrCreateRailSession,
  getPlayabilityStatus,
  type PlayabilityStatus,
  type RailSessionPoolItem,
  type RailSessionSnapshot,
  enqueuePlayabilityTrigger,
} from './playability/db.js';
import {
  AddonCatalogListSource,
  CompositeListSource,
  type ListSource,
} from './playability/list-source.js';
import { schedulePlayabilityTopUp } from './playability/top-up-scheduler.js';
import { effectivePoolTarget } from './playability/pool-growth.js';
import {
  injectPinnedSessionItems,
  loadRailCurationOverrides,
  mergePinnedPoolItems,
  shouldSkipTitleFilter,
} from './playability/rail-overrides.js';
import { normalizeSeriesVerifyId, seriesBareId } from './playability/ids.js';
import {
  CatalogError,
  couchSafeCatalogMessage,
  isAddonRateLimitMessage,
  isBlockedCatalogMeta,
  isElfHostedAddonName,
} from './catalog-errors.js';
import { resolvePosterFromMeta } from './poster.js';
import { CONTINUE_RAIL_ID } from './progress/config.js';
import { getWatchProgressForTitle, listContinueItems } from './progress/db.js';
import { assembleSeriesEpisodes, type SeriesEpisodesResponse } from './episodes.js';
import { listUserPins } from './user-pins.js';
import {
  channelSubtitle,
  fetchLiveCatalogChannels,
  loadLiveRailConfig,
  partitionChannelsBySportRails,
  type LiveChannelMeta,
  type LiveRailConfig,
  type LiveSportRail,
} from './live-rails.js';
import {
  verifyLiveChannelCandidates,
  type VerifiedLiveChannel,
  isBlockedLiveChannel,
} from './live-stream-verify.js';
import {
  readLiveRailsDiskCache,
  writeLiveRailsDiskCache,
  liveRailsDiskCacheFresh,
} from './live-rails-cache.js';

const LIVE_TAB_CACHE_TTL_MS = 5 * 60 * 1000;

type TaggedLiveChannel = LiveChannelMeta & {
  source_manifest: string;
  source_addon: string;
  source_label?: string;
  source_catalog_type: string;
};

export const PINNED_RAIL_ID = 'pinned';

export { CatalogError } from './catalog-errors.js';

type AddonExport = {
  name?: string;
  manifestUrl?: string;
  transportUrl?: string;
  url?: string;
  manifest?: { name?: string };
};

type ManifestResource = string | { name?: string; types?: string[] };

type Manifest = {
  name?: string;
  version?: string;
  resources?: ManifestResource[];
  catalogs?: Array<{ id?: string; type?: string; name?: string }>;
  types?: string[];
};

export type Meta = {
  id: string;
  type: string;
  name?: string;
  year?: number | string;
  poster?: string;
  [key: string]: unknown;
};

export type Stream = {
  url: string;
  title?: string;
  quality?: string;
  source: string;
  [key: string]: unknown;
};

export type RailSummary = {
  id: string;
  label: string;
  tab: CatalogTab;
  type: BrowsableRail['type'];
  content_type: string;
  sources: Array<{ addon: string; catalog: string; weight: number }>;
};

export type RailItem = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  poster: string;
  year?: number | string;
  description?: string;
  source: string;
  progress?: {
    play_id: string;
    position_sec: number;
    duration_sec: number;
    progress_pct: number;
  };
};

export type RailItemsResponse = {
  rail_id: string;
  label: string;
  items: RailItem[];
  resolve_ms: number;
  skipped: number;
  cached?: boolean;
  playability: {
    displayed: number;
    verified_pool: number;
    pending: number;
    low_water: boolean;
    session_id: string;
  };
};

export type TabRailItemsResponse = {
  tab: CatalogTab;
  rails: RailItemsResponse[];
  resolve_ms: number;
  cached?: boolean;
  stale?: boolean;
};

type Addon = {
  name: string;
  manifestUrl: string;
  manifest: Manifest;
};

type RawStreamResolution = {
  streams: Stream[];
  errors: string[];
  resolveMs: number;
  cached: boolean;
};

type CoreStatus = {
  version: string;
  ready: boolean;
};

const require = createRequire(import.meta.url);
const DEFAULT_EXPORT_PATH = '/etc/mango/stremio-export.json';
const REQUEST_TIMEOUT_MS = Number(process.env.MANGO_CATALOG_REQUEST_TIMEOUT_MS || 20000);
const META_CACHE_TTL_MS = Number(process.env.MANGO_META_CACHE_TTL_MS || 10 * 60 * 1000);
const META_RATE_LIMIT_BACKOFF_MS = Number(process.env.MANGO_META_RATE_LIMIT_BACKOFF_MS || 5 * 60 * 1000);
const STREAM_CACHE_TTL_MS = Number(process.env.MANGO_STREAM_CACHE_TTL_MS || 10 * 60 * 1000);
const RAIL_ITEMS_CACHE_TTL_MS = Number(process.env.MANGO_RAIL_ITEMS_CACHE_TTL_MS || 45 * 60 * 1000);
const RAIL_META_CONCURRENCY = Number(process.env.MANGO_RAIL_META_CONCURRENCY || 2);
const RAIL_META_STAGGER_MS = Number(process.env.MANGO_RAIL_META_STAGGER_MS || 400);
const STREAM_RESOLVE_BUDGET_MS = Number(process.env.MANGO_STREAM_RESOLVE_BUDGET_MS || 12000);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapInBatches<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  betweenBatchesMs = 0,
): Promise<R[]> {
  const results: R[] = [];
  const limit = Math.max(1, concurrency);
  for (let offset = 0; offset < items.length; offset += limit) {
    const batch = items.slice(offset, offset + limit);
    const batchResults = await Promise.all(
      batch.map((item, index) => mapper(item, offset + index)),
    );
    results.push(...batchResults);
    if (betweenBatchesMs > 0 && offset + limit < items.length) {
      await delay(betweenBatchesMs);
    }
  }
  return results;
}

function normalizeAddons(data: unknown): Array<{ name: string; manifestUrl: string }> {
  const root = data as { addons?: AddonExport[] | { addons?: AddonExport[] } };
  const raw = Array.isArray(root?.addons)
    ? root.addons
    : Array.isArray(root?.addons?.addons)
      ? root.addons.addons
      : [];

  return raw
    .map((addon) => {
      const manifest = typeof addon.manifest === 'object' && addon.manifest !== null ? addon.manifest : {};
      const manifestUrl = addon.manifestUrl || addon.transportUrl || addon.url;
      if (!manifestUrl) return null;
      const name = addon.name || manifest.name || new URL(manifestUrl).hostname;
      return { name: String(name), manifestUrl: String(manifestUrl) };
    })
    .filter((addon): addon is { name: string; manifestUrl: string } => addon !== null);
}

async function fetchJson(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const rawBody = await response.text();
    if (!response.ok) {
      let detail = rawBody.trim().slice(0, 200);
      try {
        const parsed = JSON.parse(rawBody) as { error?: unknown; message?: unknown };
        if (typeof parsed.error === 'string') detail = parsed.error;
        else if (typeof parsed.message === 'string') detail = parsed.message;
      } catch {
        // keep text snippet
      }
      const message = detail || `HTTP ${response.status}`;
      if (response.status === 429 || isAddonRateLimitMessage(message)) {
        throw new CatalogError(503, message, undefined, {
          couchMessage: couchSafeCatalogMessage(message),
        });
      }
      throw new Error(message);
    }
    return rawBody ? JSON.parse(rawBody) as unknown : {};
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function supportsResource(manifest: Manifest, resourceName: string, type: string): boolean {
  const resources = manifest.resources || [];
  if (resources.length === 0) return false;

  return resources.some((resource) => {
    if (typeof resource === 'string') {
      return resource === resourceName;
    }
    if (resource.name !== resourceName) {
      return false;
    }
    return !Array.isArray(resource.types) || resource.types.length === 0 || resource.types.includes(type);
  });
}

function resourceUrl(addon: Addon, resource: string, type: string, id: string): string {
  const encodedType = encodeURIComponent(type);
  const encodedId = encodeURIComponent(id);
  const url = new URL(addon.manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/${resource}/${encodedType}/${encodedId}.json`;
  url.hash = '';
  return url.toString();
}

function normalizeAddonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\|\s*/g, '|')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaYear(meta: Meta): number | string | undefined {
  if (meta.year !== undefined) return meta.year;
  const released = typeof meta.released === 'string' ? meta.released : '';
  const releaseInfo = typeof meta.releaseInfo === 'string' ? meta.releaseInfo : '';
  const match = `${released} ${releaseInfo}`.match(/\b(19|20)\d{2}\b/);
  return match?.[0];
}

function previewId(preview: unknown): string | null {
  if (typeof preview !== 'object' || preview === null) return null;
  const id = (preview as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

function previewType(preview: unknown, fallbackType: string): string {
  if (typeof preview !== 'object' || preview === null) return fallbackType;
  const type = (preview as { type?: unknown }).type;
  return typeof type === 'string' && type.trim() !== '' ? type.trim() : fallbackType;
}

function installCoreNodeShims(): void {
  const realFetch = globalThis.fetch;
  const globals = globalThis as Record<string, unknown>;
  globals.self = globalThis;
  globals.document = { baseURI: 'file:///' };
  globals.navigator ??= { language: 'en-US' };
  globals.WorkerGlobalScope ??= Object;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('http://127.0.0.1:11470/')) {
      const path = new URL(url).pathname;
      const body = path === '/device-info'
        ? { os: 'linux', arch: process.arch, shell: 'mango-catalog-service' }
        : path === '/network-info'
          ? { available: true }
          : path === '/casting'
            ? { devices: [] }
            : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  };

  const store = new Map<string, string>();
  globals.get_location_hash = async () => '';
  globals.local_storage_get_item = async (key: string) => store.get(key) ?? null;
  globals.local_storage_set_item = async (key: string, value: string) => {
    store.set(key, value);
    return null;
  };
  globals.local_storage_remove_item = async (key: string) => {
    store.delete(key);
    return null;
  };
}

async function bootStremioCore(): Promise<CoreStatus> {
  installCoreNodeShims();
  const packageJsonPath = require.resolve('@stremio/stremio-core-web/package.json');
  const wasmPath = require.resolve('@stremio/stremio-core-web/stremio_core_web_bg.wasm');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string };
  const core = require('@stremio/stremio-core-web') as {
    default: (arg: { module_or_path: Buffer }) => Promise<unknown>;
    initialize_runtime: (emit: (event: unknown) => void) => Promise<unknown>;
  };

  await core.default({ module_or_path: await readFile(wasmPath) });
  await core.initialize_runtime(() => undefined);
  return { version: packageJson.version, ready: true };
}

function normalizeStream(stream: unknown, source: string): Stream | null {
  if (typeof stream !== 'object' || stream === null) return null;
  const raw = stream as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url : typeof raw.externalUrl === 'string' ? raw.externalUrl : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return enrichStreamMetadata({
    ...raw,
    url,
    title: typeof raw.title === 'string' ? raw.title : typeof raw.name === 'string' ? raw.name : undefined,
    quality: typeof raw.quality === 'string' ? raw.quality : undefined,
    source,
  });
}

export class CatalogCore {
  private readonly metaCache = new Map<string, { meta?: Meta; expiresAt: number; blocked?: boolean }>();
  private readonly streamCache = new Map<string, {
    streams: Stream[];
    errors: string[];
    resolveMs: number;
    expiresAt: number;
  }>();
  private readonly railItemsCache = new Map<string, {
    payload: RailItemsResponse;
    expiresAt: number;
  }>();
  private readonly tabRailItemsCache = new Map<CatalogTab, {
    payload: TabRailItemsResponse;
    expiresAt: number;
  }>();
  private liveTabRailItemsCache: {
    payload: TabRailItemsResponse;
    expiresAt: number;
  } | null = null;
  private playabilitySessionId = process.env.MANGO_PLAYABILITY_SESSION_ID || randomUUID();

  private constructor(
    private readonly coreStatus: CoreStatus,
    private readonly addons: Addon[],
    private readonly filterConfig: Awaited<ReturnType<typeof loadFilterConfig>>,
    private readonly railConfig: RailConfig | null,
    private readonly railConfigError: Error | null,
    private readonly liveRailConfig: LiveRailConfig | null,
    private readonly liveRailConfigError: Error | null,
  ) {}

  static async create(exportPath = process.env.MANGO_STREMIO_EXPORT || DEFAULT_EXPORT_PATH): Promise<CatalogCore> {
    const [coreStatus, exportData] = await Promise.all([
      bootStremioCore(),
      readFile(exportPath, 'utf8').then((raw) => JSON.parse(raw) as unknown),
    ]);
    const exported = normalizeAddons(exportData);
    if (exported.length === 0) {
      throw new CatalogError(500, `${exportPath} has no addon manifest URLs`);
    }

    const addons: Addon[] = [];
    for (const addon of exported) {
      const manifest = await fetchJson(addon.manifestUrl) as Manifest;
      addons.push({
        name: manifest.name || addon.name,
        manifestUrl: addon.manifestUrl,
        manifest,
      });
    }
    const [filterConfig, railConfigResult, liveRailConfigResult] = await Promise.all([
      loadFilterConfig(),
      loadRailConfig()
        .then((config) => ({ config, error: null }))
        .catch((error: unknown) => ({
          config: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })),
      loadLiveRailConfig()
        .then((config) => ({ config, error: null }))
        .catch((error: unknown) => ({
          config: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })),
    ]);
    return new CatalogCore(
      coreStatus,
      addons,
      filterConfig,
      railConfigResult.config,
      railConfigResult.error,
      liveRailConfigResult.config,
      liveRailConfigResult.error,
    );
  }

  health(): Record<string, unknown> {
    return {
      ok: true,
      core: this.coreStatus.ready ? 'ready' : 'not_ready',
      core_version: this.coreStatus.version,
      addons: this.addons.length,
      addon_names: this.addons.map((addon) => addon.name),
      rails: this.railConfig ? enabledBrowsableRails(this.railConfig).length : 0,
      rails_ready: this.railConfigError === null,
      live_rails: this.liveRailConfig ? this.liveRailConfig.rails.length : 0,
      live_ready: this.liveRailConfigError === null,
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  rails(tab?: CatalogTab): { rails: RailSummary[]; tab?: CatalogTab } {
    if (tab === 'live') {
      const config = this.requireLiveRailConfig();
      return {
        tab: 'live',
        rails: config.rails.map((rail) => ({
          id: rail.id,
          label: rail.label,
          tab: 'live' as const,
          type: 'addon_catalog' as const,
          content_type: config.catalog_type,
          sources: [{ addon: config.addon, catalog: config.catalog, weight: 1 }],
        })),
      };
    }
    const rails = enabledBrowsableRailsForTab(this.requireRailConfig(), tab);
    return {
      ...(tab ? { tab } : {}),
      rails: rails.map((rail) => ({
        id: rail.id,
        label: rail.label,
        tab: rail.tab,
        type: rail.type,
        content_type: rail.content_type,
        sources: railSourceSummary(rail),
      })),
    };
  }

  browsableRails(): BrowsableRail[] {
    return enabledBrowsableRails(this.requireRailConfig());
  }

  browsableRail(railId: string): BrowsableRail {
    const rail = this.browsableRails().find((candidate) => candidate.id === railId);
    if (!rail) {
      throw new CatalogError(404, `unknown rail: ${railId}`);
    }
    return rail;
  }

  listSourceForRail(railId: string): ListSource {
    const rail = this.browsableRail(railId);
    if (rail.type === 'addon_catalog') {
      const addon = this.findAddonByName(rail.addon);
      return AddonCatalogListSource.fromRail(rail, addon.manifestUrl);
    }
    const sources = rail.sources.map((source) => {
      const addon = this.findAddonByName(source.addon);
      return {
        ...source,
        manifestUrl: addon.manifestUrl,
        sourceLabel: `${source.addon}/${source.catalog}`,
      };
    });
    return new CompositeListSource(rail.id, rail.content_type, sources);
  }

  async playabilityStatus(): Promise<PlayabilityStatus> {
    const rails = this.railConfig ? enabledBrowsableRails(this.railConfig).map((rail) => rail.id) : [];
    return getPlayabilityStatus(rails);
  }

  /** New session id — reshuffle rails from latest verified pool (no indexer). */
  reshufflePlayabilitySession(): string {
    this.playabilitySessionId = randomUUID();
    this.railItemsCache.clear();
    this.tabRailItemsCache.clear();
    this.liveTabRailItemsCache = null;
    return this.playabilitySessionId;
  }

  currentPlayabilitySessionId(): string {
    return this.playabilitySessionId;
  }

  clearRailItemsCache(railId?: string): void {
    if (railId) {
      this.railItemsCache.delete(railId);
      try {
        const rail = this.browsableRail(railId);
        this.tabRailItemsCache.delete(rail.tab);
      } catch {
        // unknown rail — tab cache left intact
      }
      return;
    }
    this.railItemsCache.clear();
    this.tabRailItemsCache.clear();
    this.liveTabRailItemsCache = null;
  }

  private requireLiveRailConfig(): LiveRailConfig {
    if (this.liveRailConfig) {
      return this.liveRailConfig;
    }
    const reason = this.liveRailConfigError?.message || 'catalog-live yaml not loaded';
    throw new CatalogError(503, `live rails unavailable: ${reason}`);
  }

  private livePlayabilityStub(displayed: number): RailItemsResponse['playability'] {
    return {
      displayed,
      verified_pool: displayed,
      pending: 0,
      low_water: false,
      session_id: 'live',
    };
  }

  private liveChannelToRailItem(channel: VerifiedLiveChannel): RailItem {
    const sourceLabel = channel.source_label || channel.source_addon;
    const subtitle = channelSubtitle(channel);
    return {
      id: channel.id,
      type: 'tv',
      title: channel.name,
      subtitle: sourceLabel ? `${sourceLabel} · ${subtitle}` : subtitle,
      poster: channel.poster || '',
      description: channel.description || channel.releaseInfo,
      source: channel.source_addon,
    };
  }

  private async fetchTaggedLiveChannels(
    config: LiveRailConfig,
  ): Promise<TaggedLiveChannel[]> {
    const tagged: TaggedLiveChannel[] = [];
    for (const source of config.sources) {
      const addon = this.findAddonByName(source.addon);
      const channels = await fetchLiveCatalogChannels(addon.manifestUrl, source, fetchJson);
      for (const channel of channels) {
        tagged.push({
          ...channel,
          source_manifest: addon.manifestUrl,
          source_addon: source.addon,
          source_label: source.label,
          source_catalog_type: source.catalog_type,
        });
      }
    }
    return tagged;
  }

  private orderLiveCandidates(
    candidates: TaggedLiveChannel[],
    config: LiveRailConfig,
  ): TaggedLiveChannel[] {
    const order = new Map(config.sources.map((source, index) => [source.addon, index]));
    return [...candidates].sort((left, right) => {
      const leftOrder = order.get(left.source_addon) ?? 99;
      const rightOrder = order.get(right.source_addon) ?? 99;
      return leftOrder - rightOrder;
    });
  }

  private async verifyRailChannels(
    rail: LiveSportRail,
    candidates: TaggedLiveChannel[],
    config: LiveRailConfig,
  ): Promise<VerifiedLiveChannel[]> {
    const ordered = this.orderLiveCandidates(candidates, config);
    if (!config.verify_streams || ordered.length === 0) {
      return ordered.slice(0, rail.limit).map((channel) => ({
        ...channel,
        source_addon: channel.source_addon,
        source_label: channel.source_label,
      }));
    }

    const bySource = new Map<string, TaggedLiveChannel[]>();
    for (const channel of ordered) {
      const bucket = bySource.get(channel.source_addon) || [];
      bucket.push(channel);
      bySource.set(channel.source_addon, bucket);
    }

    const verified: VerifiedLiveChannel[] = [];
    for (const source of config.sources) {
      if (verified.length >= rail.limit) {
        break;
      }
      const pool = bySource.get(source.addon) || [];
      if (pool.length === 0) {
        continue;
      }
      const addon = this.findAddonByName(source.addon);
      const next = await verifyLiveChannelCandidates(
        addon.manifestUrl,
        source.catalog_type,
        source.addon,
        source.label,
        pool,
        Math.min(rail.limit - verified.length, config.verify_max_per_rail),
        fetchJson,
        {
          poolMultiplier: config.verify_pool_multiplier,
          delayMs: config.verify_delay_ms,
        },
      );
      verified.push(...next);
    }
    if (verified.length > 0) {
      return verified.slice(0, rail.limit);
    }
    // NexoTV rate limits stream resolves — still surface free legal channels for browse.
    const freeFallback = ordered
      .filter((channel) => channel.source_label === 'free' && !isBlockedLiveChannel(channel))
      .slice(0, rail.limit)
      .map((channel) => ({
        ...channel,
        source_addon: channel.source_addon,
        source_label: channel.source_label,
      }));
    return freeFallback;
  }

  private async buildLiveRailItemsResponse(
    rail: LiveSportRail,
    channels: VerifiedLiveChannel[],
    started: number,
  ): Promise<RailItemsResponse> {
    const items = channels.map((channel) => this.liveChannelToRailItem(channel));
    return {
      rail_id: rail.id,
      label: rail.label,
      items,
      resolve_ms: Date.now() - started,
      skipped: 0,
      playability: this.livePlayabilityStub(items.length),
    };
  }

  async liveTabRailItems(options: { reshuffle?: boolean } = {}): Promise<TabRailItemsResponse> {
    const reshuffle = Boolean(options.reshuffle);
    if (reshuffle) {
      this.liveTabRailItemsCache = null;
    }

    const cached = this.liveTabRailItemsCache;
    if (!reshuffle && cached && cached.expiresAt > Date.now()) {
      return { ...cached.payload, cached: true };
    }

    const diskCache = await readLiveRailsDiskCache();
    if (!reshuffle && liveRailsDiskCacheFresh(diskCache) && !cached) {
      const payload = diskCache.payload as TabRailItemsResponse;
      this.liveTabRailItemsCache = {
        payload,
        expiresAt: diskCache.expires_at,
      };
      return { ...payload, cached: true };
    }

    const started = Date.now();
    const config = this.requireLiveRailConfig();
    const tagged = await this.fetchTaggedLiveChannels(config);
    const byRail = partitionChannelsBySportRails(tagged, config.rails);

    const responses: RailItemsResponse[] = [];
    for (const rail of config.rails) {
      const matched = (byRail.get(rail.id) || []) as TaggedLiveChannel[];
      if (matched.length === 0) {
        continue;
      }
      const verified = await this.verifyRailChannels(rail, matched, config);
      if (verified.length === 0) {
        continue;
      }
      responses.push(await this.buildLiveRailItemsResponse(rail, verified, started));
    }

    const pinnedRail = await this.buildPinnedRail('live');
    if (pinnedRail.items.length > 0) {
      responses.unshift(pinnedRail);
    }

    if (responses.length === 0) {
      const fallback = cached?.payload
        || (liveRailsDiskCacheFresh(diskCache) ? diskCache.payload as TabRailItemsResponse : null);
      if (fallback && fallback.rails.length > 0) {
        return { ...fallback, cached: true, stale: true };
      }
      this.liveTabRailItemsCache = null;
      return { tab: 'live', rails: [], resolve_ms: Date.now() - started };
    }

    const payload: TabRailItemsResponse = {
      tab: 'live',
      rails: responses,
      resolve_ms: Date.now() - started,
    };
    const ttlMs = (config.cache_ttl_sec ?? 600) * 1000;
    const expiresAt = Date.now() + Math.max(ttlMs, LIVE_TAB_CACHE_TTL_MS);
    this.liveTabRailItemsCache = { payload, expiresAt };
    await writeLiveRailsDiskCache(
      { ...payload, tab: 'live' },
      Math.ceil((expiresAt - Date.now()) / 1000),
    ).catch(() => undefined);
    return payload;
  }

  private siblingRailIds(rail: BrowsableRail): string[] {
    return enabledBrowsableRailsForTab(this.requireRailConfig(), rail.tab)
      .map((entry) => entry.id)
      .filter((id) => id !== rail.id);
  }

  private async buildPinnedRail(tab: CatalogTab): Promise<RailItemsResponse> {
    const started = Date.now();
    const pins = await listUserPins(tab);
    const items: RailItem[] = [];

    for (const pin of pins) {
      let title = pin.title;
      let poster = pin.poster;
      let year: number | string | undefined;
      let description: string | undefined;
      try {
        const meta = await this.metaCached(pin.type, pin.id);
        title = (typeof meta.name === 'string' && meta.name.trim() !== '' ? meta.name : null)
          || (typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title : null)
          || title;
        poster = resolvePosterFromMeta(meta) || poster;
        year = metaYear(meta);
        description = typeof meta.description === 'string' ? meta.description : undefined;
      } catch {
        // keep stored snapshot
      }
      items.push({
        id: pin.id,
        type: pin.type,
        title,
        subtitle: year ? String(year) : pin.type,
        poster: poster || '',
        year,
        description,
        source: 'pinned',
      });
    }

    return {
      rail_id: PINNED_RAIL_ID,
      label: 'pinned',
      items,
      resolve_ms: Date.now() - started,
      skipped: 0,
      playability: {
        displayed: items.length,
        verified_pool: items.length,
        pending: 0,
        low_water: false,
        session_id: this.playabilitySessionId,
      },
    };
  }

  private async buildContinueRail(tab: CatalogTab): Promise<RailItemsResponse> {
    const started = Date.now();
    const candidates = listContinueItems(tab);
    const items: RailItem[] = [];

    for (const candidate of candidates) {
      let title = candidate.title;
      let poster = candidate.poster;
      let year: number | string | undefined;
      try {
        const meta = await this.metaCached(candidate.type, candidate.id);
        title = (typeof meta.name === 'string' && meta.name.trim() !== '' ? meta.name : null)
          || (typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title : null)
          || title;
        poster = resolvePosterFromMeta(meta) || poster;
        year = metaYear(meta);
      } catch {
        // keep stored snapshot
      }
      items.push({
        id: candidate.id,
        type: candidate.type,
        title,
        subtitle: candidate.subtitle,
        poster: poster || '',
        year,
        description: candidate.description,
        source: candidate.source,
        progress: candidate.progress,
      });
    }

    return {
      rail_id: CONTINUE_RAIL_ID,
      label: 'continue watching',
      items,
      resolve_ms: Date.now() - started,
      skipped: 0,
      playability: {
        displayed: items.length,
        verified_pool: items.length,
        pending: 0,
        low_water: false,
        session_id: this.playabilitySessionId,
      },
    };
  }

  private async buildRailItemsResponse(
    rail: BrowsableRail,
    session: RailSessionSnapshot,
    started: number,
  ): Promise<RailItemsResponse> {
    const resolved = await mapInBatches(
      session.items,
      RAIL_META_CONCURRENCY,
      (item) => this.resolveVerifiedRailItem(item),
      RAIL_META_STAGGER_MS,
    );
    const items = resolved.filter((item): item is RailItem => item !== null);
    const pending = Math.max(0, rail.playability.min_display - items.length);
    const lowWater = items.length < rail.playability.min_display;
    const poolTarget = effectivePoolTarget(rail.playability, session.verified_pool);
    if (lowWater) {
      void enqueuePlayabilityTrigger({
        trigger_type: 'display_low',
        rail_id: rail.id,
        reason: `displayed=${items.length} min=${rail.playability.min_display}`,
      }).catch(() => undefined);
      schedulePlayabilityTopUp(rail.id);
    } else if (session.verified_pool < poolTarget * 0.5) {
      void enqueuePlayabilityTrigger({
        trigger_type: 'pool_low',
        rail_id: rail.id,
        reason: `pool=${session.verified_pool} target=${poolTarget}`,
      }).catch(() => undefined);
      schedulePlayabilityTopUp(rail.id);
    }
    return {
      rail_id: rail.id,
      label: rail.label,
      items,
      resolve_ms: Date.now() - started,
      skipped: session.items.length - items.length,
      playability: {
        displayed: items.length,
        verified_pool: session.verified_pool,
        pending,
        low_water: lowWater,
        session_id: session.session_id,
      },
    };
  }

  async tabRailItems(tab: CatalogTab, options: { reshuffle?: boolean } = {}): Promise<TabRailItemsResponse> {
    if (tab === 'live') {
      return this.liveTabRailItems(options);
    }
    const reshuffle = Boolean(options.reshuffle);
    if (reshuffle) {
      this.reshufflePlayabilitySession();
    }

    const cachedTab = this.tabRailItemsCache.get(tab);
    if (
      !reshuffle
      && cachedTab
      && cachedTab.expiresAt > Date.now()
      && cachedTab.payload.rails.every((rail) => rail.playability?.low_water !== true)
    ) {
      return { ...cachedTab.payload, cached: true };
    }

    const started = Date.now();
    const rails = enabledBrowsableRailsForTab(this.requireRailConfig(), tab);
    const sessions = await allocateTabRailSessions({
      sessionId: this.playabilitySessionId,
      rails: rails.map((rail) => ({
        railId: rail.id,
        displayLimit: rail.playability.display_limit,
        minDisplay: rail.playability.min_display,
        playability: rail.playability,
      })),
      forceReshuffle: reshuffle,
      stableRatio: reshuffle ? 0.15 : undefined,
    });

    const responses: RailItemsResponse[] = [];
    for (const rail of rails) {
      const session = sessions.get(rail.id);
      if (!session) {
        continue;
      }
      const payload = await this.buildRailItemsResponse(rail, session, started);
      responses.push(payload);
      this.railItemsCache.set(rail.id, {
        payload,
        expiresAt: Date.now() + RAIL_ITEMS_CACHE_TTL_MS,
      });
    }

    const visibleRails = responses.filter((rail) => rail.items.length > 0);
    const continueRail = await this.buildContinueRail(tab);
    if (continueRail.items.length > 0) {
      visibleRails.unshift(continueRail);
    }
    const pinnedRail = await this.buildPinnedRail(tab);
    if (pinnedRail.items.length > 0) {
      const continueIndex = visibleRails.findIndex((rail) => rail.rail_id === CONTINUE_RAIL_ID);
      const insertAt = continueIndex >= 0 ? continueIndex + 1 : 0;
      visibleRails.splice(insertAt, 0, pinnedRail);
    }

    const payload: TabRailItemsResponse = {
      tab,
      rails: visibleRails,
      resolve_ms: Date.now() - started,
    };
    this.tabRailItemsCache.set(tab, {
      payload,
      expiresAt: Date.now() + RAIL_ITEMS_CACHE_TTL_MS,
    });
    return payload;
  }

  async railItems(railId: string): Promise<RailItemsResponse> {
    const cachedRail = this.railItemsCache.get(railId);
    if (
      cachedRail
      && cachedRail.expiresAt > Date.now()
      && cachedRail.payload.playability?.low_water !== true
    ) {
      return { ...cachedRail.payload, cached: true };
    }

    const started = Date.now();
    const rail = this.browsableRail(railId);
    const session = await getOrCreateRailSession({
      railId: rail.id,
      sessionId: this.playabilitySessionId,
      displayLimit: rail.playability.display_limit,
      playability: rail.playability,
      siblingRailIds: this.siblingRailIds(rail),
    });
    const payload = await this.buildRailItemsResponse(rail, session, started);
    this.railItemsCache.set(railId, {
      payload,
      expiresAt: Date.now() + RAIL_ITEMS_CACHE_TTL_MS,
    });
    if (payload.items.length === 0) {
      return {
        ...payload,
        items: [],
      };
    }
    return payload;
  }

  async meta(type: string, id: string): Promise<Meta> {
    const errors: string[] = [];
    let merged: Meta | null = null;
    for (const addon of this.metaAddonsInOrder()) {
      if (!supportsResource(addon.manifest, 'meta', type)) continue;
      try {
        const result = await fetchJson(resourceUrl(addon, 'meta', type, id)) as { meta?: Meta };
        const piece = result.meta;
        if (!piece?.id || isBlockedCatalogMeta(piece)) {
          continue;
        }
        merged = merged
          ? Object.assign({}, merged, piece, { source: merged.source || addon.name }) as Meta
          : Object.assign({}, piece, { source: addon.name }) as Meta;
      } catch (error) {
        errors.push(`${addon.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (merged && !isBlockedCatalogMeta(merged)) {
      return merged;
    }
    throw new CatalogError(502, `meta not resolved for ${type}/${id}${errors.length ? ` (${errors.join('; ')})` : ''}`);
  }

  async seriesEpisodes(bareId: string): Promise<SeriesEpisodesResponse> {
    const trimmed = bareId.trim();
    const normalizedBare = seriesBareId(trimmed);
    if (!normalizedBare || normalizedBare.toLowerCase() !== trimmed.toLowerCase()) {
      throw new CatalogError(400, 'GET /series/:id/episodes requires bare imdb series id');
    }
    const meta = await this.meta('series', normalizedBare);
    const saved = getWatchProgressForTitle('series', normalizedBare);
    return assembleSeriesEpisodes(normalizedBare, meta, saved);
  }

  private async buildStreamFilterContext(type: string, id: string): Promise<StreamFilterContext> {
    let filterContext: StreamFilterContext = {
      contentType: type,
      metaId: id,
    };
    try {
      const meta = await this.metaCached(type, id);
      filterContext = {
        contentType: type,
        metaId: id,
        metaTitle: typeof meta.name === 'string'
          ? meta.name
          : typeof meta.title === 'string'
            ? meta.title
            : undefined,
        metaRuntimeMinutes: parseRuntimeMinutes(meta.runtime)
          ?? parseRuntimeMinutes(meta.runtimeMinutes)
          ?? undefined,
      };
    } catch {
      // title relevance filter skipped when meta unavailable
    }
    const curation = await loadRailCurationOverrides();
    if (shouldSkipTitleFilter(type, id, curation)) {
      filterContext.skipTitleFilter = true;
    }
    return filterContext;
  }

  /** Raw addon streams + merged couch config for play-ladder orchestration. */
  async resolveForPlay(
    type: string,
    id: string,
    overrides: StreamFilterOverrides = {},
  ): Promise<{
    streams: Stream[];
    resolve_ms: number;
    cached: boolean;
    filters: ReturnType<typeof mergeFilterConfig>;
    filterContext: StreamFilterContext;
    errors?: string[];
  }> {
    const streamId = normalizeSeriesVerifyId(type, id);
    const raw = await this.rawStreams(type, streamId);
    if (raw.streams.length === 0) {
      throw new CatalogError(
        502,
        `no HTTP streams for ${type}/${streamId}${raw.errors.length ? ` (${raw.errors.join('; ')})` : ''}`,
      );
    }
    return {
      streams: enrichStreams(raw.streams),
      resolve_ms: raw.cached ? 0 : raw.resolveMs,
      cached: raw.cached,
      filters: mergeFilterConfig(this.filterConfig, overrides),
      filterContext: await this.buildStreamFilterContext(type, id),
      errors: raw.errors.length > 0 ? raw.errors : undefined,
    };
  }

  async streams(
    type: string,
    id: string,
    overrides: StreamFilterOverrides = {},
  ): Promise<{
    streams: Stream[];
    resolve_ms: number;
    cached: boolean;
    filters: StreamFilterMeta;
    errors?: string[];
  }> {
    const streamId = normalizeSeriesVerifyId(type, id);
    const raw = await this.rawStreams(type, streamId);

    if (raw.streams.length === 0) {
      throw new CatalogError(
        502,
        `no HTTP streams for ${type}/${streamId}${raw.errors.length ? ` (${raw.errors.join('; ')})` : ''}`,
      );
    }

    const config = mergeFilterConfig(this.filterConfig, overrides);
    const filterContext = await this.buildStreamFilterContext(type, id);
    const idealStep = config.play_ladder[0] ?? defaultPlayLadder()[0];
    const idealStreams = filterStreamsForLadderStep(raw.streams, idealStep, filterContext, {
      strict_unknown_cache: config.strict_unknown_cache,
      preferred_quality: config.preferred_quality,
      hard_language: config.hard_language,
    });
    const filtered = idealStreams.length > 0
      ? {
        streams: idealStreams.slice(0, config.stream_display_limit),
        meta: {
          applied: config,
          total: raw.streams.length,
          kept: idealStreams.length,
          excluded: {
            uncached_debrid: 0,
            unknown_cache_debrid: 0,
            above_max_quality: 0,
            remux: 0,
            error_stream: 0,
            title_mismatch: 0,
            series_pack_for_movie: 0,
            language_mismatch: 0,
          },
          play_ladder_step: idealStep.step,
        } satisfies StreamFilterMeta,
      }
      : filterStreamsForPlay(raw.streams, config, filterContext);
    if (filtered.streams.length === 0) {
      const hint = config.exclude_uncached_debrid
        ? ' try ?include_uncached=1 or set include_uncached in POST /play'
        : '';
      throw new CatalogError(
        502,
        `no streams left after filters for ${type}/${id} (${filtered.meta.excluded.uncached_debrid} uncached, ${filtered.meta.excluded.unknown_cache_debrid} unknown-cache debrid excluded)${hint}`,
        { filters: filtered.meta },
      );
    }

    return {
      streams: filtered.streams,
      resolve_ms: raw.cached ? 0 : raw.resolveMs,
      cached: raw.cached,
      filters: filtered.meta,
      errors: raw.errors.length > 0 ? raw.errors : undefined,
    };
  }

  private requireRailConfig(): RailConfig {
    if (this.railConfig) {
      return this.railConfig;
    }
    const reason = this.railConfigError?.message || 'catalog yaml not loaded';
    throw new CatalogError(503, `catalog rails unavailable: ${reason}`);
  }

  private findAddonByName(name: string): Addon {
    const exact = this.addons.find((addon) => addon.name === name);
    if (exact) {
      return exact;
    }
    const normalized = normalizeAddonName(name);
    const fuzzy = this.addons.find((addon) => normalizeAddonName(addon.name) === normalized);
    if (fuzzy) {
      return fuzzy;
    }
    throw new CatalogError(
      502,
      `addon not found: ${name}; available: ${this.addons.map((addon) => addon.name).join(', ')}`,
    );
  }

  private metaAddonsInOrder(): Addon[] {
    return [...this.addons].sort((left, right) => {
      const leftCinemeta = normalizeAddonName(left.name) === 'cinemeta';
      const rightCinemeta = normalizeAddonName(right.name) === 'cinemeta';
      if (leftCinemeta === rightCinemeta) return 0;
      return leftCinemeta ? -1 : 1;
    });
  }

  private cacheMetaRateLimit(key: string): void {
    this.metaCache.set(key, {
      blocked: true,
      expiresAt: Date.now() + META_RATE_LIMIT_BACKOFF_MS,
    });
  }

  private async metaCached(type: string, id: string): Promise<Meta> {
    const key = `${type}:${id}`;
    const cached = this.metaCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.blocked) {
        throw new CatalogError(503, 'meta rate limited', undefined, {
          couchMessage: couchSafeCatalogMessage('rate limit exceeded'),
        });
      }
      return cached.meta as Meta;
    }
    try {
      const meta = await this.meta(type, id);
      if (isBlockedCatalogMeta(meta)) {
        this.cacheMetaRateLimit(key);
        throw new CatalogError(503, 'meta rate limited', undefined, {
          couchMessage: couchSafeCatalogMessage('rate limit exceeded'),
        });
      }
      this.metaCache.set(key, { meta, expiresAt: Date.now() + META_CACHE_TTL_MS });
      return meta;
    } catch (error) {
      if (
        error instanceof CatalogError
        && (error.status === 503 || isAddonRateLimitMessage(error.message))
      ) {
        this.cacheMetaRateLimit(key);
      }
      throw error;
    }
  }

  private async rawStreams(type: string, id: string): Promise<RawStreamResolution> {
    const key = `${type}:${id}`;
    const cached = this.streamCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        streams: cached.streams,
        errors: cached.errors,
        resolveMs: cached.resolveMs,
        cached: true,
      };
    }

    const started = Date.now();
    const streamAddons = this.addons.filter((addon) => supportsResource(addon.manifest, 'stream', type));
    const settled = await Promise.allSettled(
      streamAddons.map((addon) => this.fetchAddonStreams(addon, type, id)),
    );

    const streams: Stream[] = [];
    const errors: string[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        streams.push(...result.value.streams);
      } else {
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }

    const resolveMs = Date.now() - started;
    if (streams.length > 0) {
      this.streamCache.set(key, {
        streams,
        errors,
        resolveMs,
        expiresAt: Date.now() + STREAM_CACHE_TTL_MS,
      });
    }
    return { streams, errors, resolveMs, cached: false };
  }

  private async fetchAddonStreams(
    addon: Addon,
    type: string,
    id: string,
  ): Promise<{ streams: Stream[] }> {
    try {
      const result = await fetchJson(
        resourceUrl(addon, 'stream', type, id),
        STREAM_RESOLVE_BUDGET_MS,
      ) as { streams?: unknown[] };
      const streams: Stream[] = [];
      for (const stream of result.streams || []) {
        const normalized = normalizeStream(stream, addon.name);
        if (normalized) streams.push(normalized);
      }
      return { streams };
    } catch (error) {
      throw new Error(`${addon.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async resolveVerifiedRailItem(item: RailSessionPoolItem): Promise<RailItem | null> {
    try {
      const meta = await this.metaCached(item.type, item.id);
      if (isBlockedCatalogMeta(meta)) {
        return null;
      }
      const poster = resolvePosterFromMeta(meta);
      if (!poster) {
        return null;
      }
      const year = metaYear(meta);
      return {
        id: meta.id || item.id,
        type: meta.type || item.type,
        title: meta.name || item.id,
        subtitle: year ? String(year) : item.type,
        poster,
        year,
        description: typeof meta.description === 'string' ? meta.description : undefined,
        source: item.best_source || 'verified',
      };
    } catch (error) {
      console.warn(
        `verified rail item skipped rail=${item.rail_id} id=${item.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async resolveRailItem(
    rail: BrowsableRail,
    addon: Addon,
    preview: unknown,
  ): Promise<RailItem | null> {
    const id = previewId(preview);
    if (!id) return null;
    const type = previewType(preview, rail.content_type);

    try {
      const meta = await this.metaCached(type, id);
      if (isBlockedCatalogMeta(meta)) {
        return null;
      }
      const poster = resolvePosterFromMeta(meta, preview);
      if (!poster) {
        return null;
      }
      const year = metaYear(meta);
      return {
        id: meta.id || id,
        type: meta.type || type,
        title: meta.name || String((preview as { name?: unknown })?.name || id),
        subtitle: year ? String(year) : type,
        poster,
        year,
        description: typeof meta.description === 'string' ? meta.description : undefined,
        source: addon.name,
      };
    } catch (error) {
      console.warn(
        `rail item skipped rail=${rail.id} id=${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

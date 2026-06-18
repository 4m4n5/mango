import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import {
  filterAndRankStreams,
  loadFilterConfig,
  mergeFilterConfig,
  type StreamFilterMeta,
  type StreamFilterOverrides,
} from './stream-filters.js';

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

type Addon = {
  name: string;
  manifestUrl: string;
  manifest: Manifest;
};

type CoreStatus = {
  version: string;
  ready: boolean;
};

const require = createRequire(import.meta.url);
const DEFAULT_EXPORT_PATH = '/etc/mango/stremio-export.json';
const REQUEST_TIMEOUT_MS = Number(process.env.MANGO_CATALOG_REQUEST_TIMEOUT_MS || 20000);

export class CatalogError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
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

function qualityFromStream(stream: Record<string, unknown>): string | undefined {
  const haystack = `${stream.title || ''} ${stream.name || ''} ${stream.description || ''}`;
  return haystack.match(/\b(2160p|4k|1080p|720p|480p)\b/i)?.[1];
}

function normalizeStream(stream: unknown, source: string): Stream | null {
  if (typeof stream !== 'object' || stream === null) return null;
  const raw = stream as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url : typeof raw.externalUrl === 'string' ? raw.externalUrl : '';
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    ...raw,
    url,
    title: typeof raw.title === 'string' ? raw.title : typeof raw.name === 'string' ? raw.name : undefined,
    quality: qualityFromStream(raw),
    source,
  };
}

export class CatalogCore {
  private constructor(
    private readonly coreStatus: CoreStatus,
    private readonly addons: Addon[],
    private readonly filterConfig: Awaited<ReturnType<typeof loadFilterConfig>>,
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
    const filterConfig = await loadFilterConfig();
    return new CatalogCore(coreStatus, addons, filterConfig);
  }

  health(): Record<string, unknown> {
    return {
      ok: true,
      core: this.coreStatus.ready ? 'ready' : 'not_ready',
      core_version: this.coreStatus.version,
      addons: this.addons.length,
      addon_names: this.addons.map((addon) => addon.name),
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  async meta(type: string, id: string): Promise<Meta> {
    const errors: string[] = [];
    for (const addon of this.addons) {
      if (!supportsResource(addon.manifest, 'meta', type)) continue;
      try {
        const result = await fetchJson(resourceUrl(addon, 'meta', type, id)) as { meta?: Meta };
        if (result.meta?.id) {
          return { ...result.meta, source: addon.name };
        }
      } catch (error) {
        errors.push(`${addon.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new CatalogError(502, `meta not resolved for ${type}/${id}${errors.length ? ` (${errors.join('; ')})` : ''}`);
  }

  async streams(
    type: string,
    id: string,
    overrides: StreamFilterOverrides = {},
  ): Promise<{ streams: Stream[]; resolve_ms: number; filters: StreamFilterMeta }> {
    const started = Date.now();
    const errors: string[] = [];
    const streams: Stream[] = [];

    for (const addon of this.addons) {
      if (!supportsResource(addon.manifest, 'stream', type)) continue;
      try {
        const result = await fetchJson(resourceUrl(addon, 'stream', type, id)) as { streams?: unknown[] };
        for (const stream of result.streams || []) {
          const normalized = normalizeStream(stream, addon.name);
          if (normalized) streams.push(normalized);
        }
      } catch (error) {
        errors.push(`${addon.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (streams.length === 0) {
      throw new CatalogError(502, `no HTTP streams for ${type}/${id}${errors.length ? ` (${errors.join('; ')})` : ''}`);
    }

    const config = mergeFilterConfig(this.filterConfig, overrides);
    const filtered = filterAndRankStreams(streams, config);
    if (filtered.streams.length === 0) {
      const hint = config.exclude_uncached_debrid
        ? ' try ?include_uncached=1 or set include_uncached in POST /play'
        : '';
      throw new CatalogError(
        502,
        `no streams left after filters for ${type}/${id} (${filtered.meta.excluded.uncached_debrid} uncached debrid excluded)${hint}`,
      );
    }

    return {
      streams: filtered.streams,
      resolve_ms: Date.now() - started,
      filters: filtered.meta,
    };
  }
}

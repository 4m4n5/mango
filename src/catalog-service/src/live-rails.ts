import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export type LiveSportRail = {
  id: string;
  label: string;
  keywords: string[];
  limit: number;
  include_genres?: string[];
  exclude_keywords?: string[];
};

export type LiveSourceConfig = {
  addon: string;
  catalog: string;
  catalog_type: string;
  pages: number;
  label?: string;
};

export type LiveRailConfig = {
  version: number;
  addon: string;
  catalog: string;
  catalog_type: string;
  pages: number;
  cache_ttl_sec: number;
  verify_streams: boolean;
  verify_pool_multiplier: number;
  verify_delay_ms: number;
  sources: LiveSourceConfig[];
  rails: LiveSportRail[];
};

export type LiveChannelMeta = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  genre?: string;
  poster?: string;
  releaseInfo?: string;
};

const DEFAULT_LIVE_CATALOG_PATH = '/etc/mango/catalog-live.yaml';
const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoDir = resolve(moduleDir, '../../..');

function repoDir(): string {
  return process.env.MANGO_REPO_DIR || defaultRepoDir;
}

function defaultLiveCatalogPath(): string {
  return process.env.MANGO_CATALOG_LIVE_YAML
    || DEFAULT_LIVE_CATALOG_PATH;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${context}.${key} must be a non-empty string`);
  }
  return value.trim();
}

function readPositiveInt(
  record: Record<string, unknown>,
  key: string,
  context: string,
  fallback: number,
): number {
  const value = record[key];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${context}.${key} must be a positive integer`);
  }
  return parsed;
}

function readKeywords(record: Record<string, unknown>, context: string): string[] {
  const value = record.keywords;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context}.keywords must be a non-empty array`);
  }
  return value.map((keyword, index) => {
    if (typeof keyword !== 'string' || keyword.trim() === '') {
      throw new Error(`${context}.keywords[${index}] must be a non-empty string`);
    }
    return keyword.trim();
  });
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array when set`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`${key}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
}

function readLiveSportRail(record: Record<string, unknown>, index: number): LiveSportRail {
  const context = `live rails[${index}]`;
  const id = readString(record, 'id', context);
  const label = typeof record.label === 'string' && record.label.trim() !== ''
    ? record.label.trim()
    : id.replace(/-/g, ' ');
  return {
    id,
    label,
    keywords: readKeywords(record, context),
    limit: readPositiveInt(record, 'limit', context, 20),
    include_genres: readOptionalStringArray(record, 'include_genres'),
    exclude_keywords: readOptionalStringArray(record, 'exclude_keywords'),
  };
}

function readLiveSourceConfig(record: Record<string, unknown>, index: number, fallback: {
  addon: string;
  catalog: string;
  catalog_type: string;
  pages: number;
}): LiveSourceConfig {
  const context = `live sources[${index}]`;
  return {
    addon: readString(record, 'addon', context),
    catalog: readString(record, 'catalog', context),
    catalog_type: typeof record.catalog_type === 'string' && record.catalog_type.trim() !== ''
      ? record.catalog_type.trim()
      : fallback.catalog_type,
    pages: readPositiveInt(record, 'pages', context, fallback.pages),
    label: typeof record.label === 'string' && record.label.trim() !== ''
      ? record.label.trim()
      : undefined,
  };
}

export async function loadLiveRailConfig(path = defaultLiveCatalogPath()): Promise<LiveRailConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const fallback = resolve(repoDir(), 'config/catalog-live.example.yaml');
    if (path !== fallback) {
      return loadLiveRailConfig(fallback);
    }
    throw error;
  }

  const parsed = asRecord(parseYaml(raw), path);
  const version = Number(parsed.version ?? 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('live catalog version must be a positive integer');
  }
  if (!Array.isArray(parsed.rails) || parsed.rails.length === 0) {
    throw new Error('live catalog rails must be a non-empty array');
  }

  const rails = parsed.rails.map((rail, index) => readLiveSportRail(asRecord(rail, `live rails[${index}]`), index));
  const seen = new Set<string>();
  for (const rail of rails) {
    if (seen.has(rail.id)) {
      throw new Error(`duplicate live rail id: ${rail.id}`);
    }
    seen.add(rail.id);
  }

  const catalogType = typeof parsed.catalog_type === 'string' && parsed.catalog_type.trim() !== ''
    ? parsed.catalog_type.trim()
    : 'tv';
  const defaultAddon = typeof parsed.addon === 'string' ? parsed.addon.trim() : '';
  const defaultCatalog = typeof parsed.catalog === 'string' ? parsed.catalog.trim() : 'iptv_channels';
  const defaultPages = readPositiveInt(parsed, 'pages', path, 2);

  let sources: LiveSourceConfig[] = [];
  if (Array.isArray(parsed.sources) && parsed.sources.length > 0) {
    sources = parsed.sources.map((source, index) => readLiveSourceConfig(
      asRecord(source, `live sources[${index}]`),
      index,
      {
        addon: defaultAddon,
        catalog: defaultCatalog,
        catalog_type: catalogType,
        pages: defaultPages,
      },
    ));
  } else if (defaultAddon) {
    sources = [{
      addon: defaultAddon,
      catalog: defaultCatalog,
      catalog_type: catalogType,
      pages: defaultPages,
    }];
  } else {
    throw new Error('live catalog requires addon or sources[]');
  }

  const primary = sources[0];
  return {
    version,
    addon: primary.addon,
    catalog: primary.catalog,
    catalog_type: primary.catalog_type,
    pages: primary.pages,
    cache_ttl_sec: readPositiveInt(parsed, 'cache_ttl_sec', path, 300),
    verify_streams: parsed.verify_streams !== false,
    verify_pool_multiplier: readPositiveInt(parsed, 'verify_pool_multiplier', path, 2),
    verify_delay_ms: readPositiveInt(parsed, 'verify_delay_ms', path, 120),
    sources,
    rails,
  };
}

export function buildLiveCatalogUrl(
  manifestUrl: string,
  catalogType: string,
  catalogId: string,
  skip: number,
): string {
  const url = new URL(manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/catalog/${encodeURIComponent(catalogType)}/${encodeURIComponent(catalogId)}/skip=${skip}.json`;
  url.hash = '';
  return url.toString();
}

export function keywordPattern(keywords: string[]): RegExp {
  const parts = keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((keyword) => keyword
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+'));
  if (parts.length === 0) {
    return /^$/;
  }
  return new RegExp(`\\b(${parts.join('|')})\\b`, 'i');
}

export function searchableChannelText(channel: LiveChannelMeta): string {
  return [channel.name, channel.title, channel.description, channel.genre, channel.releaseInfo]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join(' ');
}

export function channelSubtitle(channel: LiveChannelMeta): string {
  if (typeof channel.releaseInfo === 'string' && channel.releaseInfo.trim() !== '') {
    return channel.releaseInfo.trim();
  }
  if (typeof channel.genre === 'string' && channel.genre.trim() !== '') {
    return channel.genre.trim();
  }
  return 'live';
}

export function normalizeLiveChannelMeta(meta: Record<string, unknown>): LiveChannelMeta | null {
  const id = typeof meta.id === 'string' ? meta.id.trim() : '';
  if (!id) {
    return null;
  }
  const name = typeof meta.name === 'string' && meta.name.trim() !== ''
    ? meta.name.trim()
    : typeof meta.title === 'string' && meta.title.trim() !== ''
      ? meta.title.trim()
      : id;
  return {
    id,
    name,
    title: typeof meta.title === 'string' ? meta.title : undefined,
    description: typeof meta.description === 'string' ? meta.description : undefined,
    genre: typeof meta.genre === 'string' ? meta.genre : undefined,
    poster: typeof meta.poster === 'string' ? meta.poster : undefined,
    releaseInfo: typeof meta.releaseInfo === 'string' ? meta.releaseInfo : undefined,
  };
}

export function matchChannelsToRail(
  channels: LiveChannelMeta[],
  rail: LiveSportRail,
  assignedIds: Set<string>,
): LiveChannelMeta[] {
  const pattern = keywordPattern(rail.keywords);
  const genrePattern = rail.include_genres?.length
    ? keywordPattern(rail.include_genres)
    : null;
  const excludePattern = rail.exclude_keywords?.length
    ? keywordPattern(rail.exclude_keywords)
    : null;
  const matches: LiveChannelMeta[] = [];
  for (const channel of channels) {
    if (assignedIds.has(channel.id)) {
      continue;
    }
    const text = searchableChannelText(channel);
    if (excludePattern?.test(text)) {
      continue;
    }
    if (!pattern.test(text) && !(genrePattern && genrePattern.test(text))) {
      continue;
    }
    matches.push(channel);
    assignedIds.add(channel.id);
    if (matches.length >= rail.limit) {
      break;
    }
  }
  return matches;
}

export function partitionChannelsBySportRails(
  channels: LiveChannelMeta[],
  rails: LiveSportRail[],
): Map<string, LiveChannelMeta[]> {
  const assigned = new Set<string>();
  const byRail = new Map<string, LiveChannelMeta[]>();
  for (const rail of rails) {
    byRail.set(rail.id, matchChannelsToRail(channels, rail, assigned));
  }
  return byRail;
}

type JsonFetcher = (url: string, timeoutMs?: number) => Promise<unknown>;

export async function fetchLiveCatalogChannels(
  manifestUrl: string,
  source: Pick<LiveSourceConfig, 'catalog' | 'catalog_type' | 'pages'>,
  fetchJson: JsonFetcher,
  timeoutMs = 45_000,
): Promise<LiveChannelMeta[]> {
  const channels: LiveChannelMeta[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < source.pages; page += 1) {
    const skip = page * 100;
    const url = buildLiveCatalogUrl(manifestUrl, source.catalog_type, source.catalog, skip);
    let data: unknown;
    try {
      data = await fetchJson(url, timeoutMs);
    } catch (error) {
      if (page > 0) {
        break;
      }
      throw error;
    }
    const metas = (data as { metas?: unknown[] }).metas;
    if (!Array.isArray(metas) || metas.length === 0) {
      break;
    }
    for (const raw of metas) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }
      const channel = normalizeLiveChannelMeta(raw as Record<string, unknown>);
      if (!channel || seen.has(channel.id)) {
        continue;
      }
      seen.add(channel.id);
      channels.push(channel);
    }
    if (page + 1 < source.pages) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return channels;
}

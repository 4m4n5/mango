import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export type RailType = 'addon_catalog' | 'composite_list' | 'stremio_library' | 'tmdb_list' | 'static_ids';

export type CatalogTab = 'movies' | 'series' | 'live';

const CATALOG_TABS = new Set<CatalogTab>(['movies', 'series', 'live']);

export type RailPlayabilityConfig = {
  display_limit: number;
  /** Max visible posters when pool_growth_per_refresh > 0 (10-ft UI cap). */
  display_max: number;
  min_display: number;
  ingest_multiplier: number;
  /** Floor verified pool size; also legacy cap when pool_growth_per_refresh is 0. */
  pool_target: number;
  /** Verified titles to add per refresh when > 0 (accumulative growth). */
  pool_growth_per_refresh: number;
  /** Upper bound on verified pool depth per rail. */
  pool_max: number;
};

export type CatalogSourceRef = {
  addon: string;
  catalog: string;
  weight: number;
};

type BrowsableRailBase = {
  id: string;
  label: string;
  tab: CatalogTab;
  content_type: string;
  limit: number;
  playability: RailPlayabilityConfig;
  enabled: true;
};

export type AddonCatalogRail = BrowsableRailBase & {
  type: 'addon_catalog';
  addon: string;
  catalog: string;
};

export type CompositeListRail = BrowsableRailBase & {
  type: 'composite_list';
  sources: CatalogSourceRef[];
};

export type BrowsableRail = AddonCatalogRail | CompositeListRail;

export type DisabledRail = {
  id: string;
  label: string;
  type: RailType;
  enabled: false;
};

export type RailDefinition = BrowsableRail | DisabledRail;

export type RailConfig = {
  version: number;
  rails: RailDefinition[];
};

const DEFAULT_CATALOG_PATH = '/etc/mango/catalog.yaml';
const DEFAULT_RAIL_LIMIT = 20;
const MAX_RAIL_LIMIT = 50;
export const DEFAULT_PLAYABILITY_CONFIG: RailPlayabilityConfig = {
  display_limit: 9,
  display_max: 9,
  min_display: 6,
  ingest_multiplier: 5,
  pool_target: 60,
  pool_growth_per_refresh: 10,
  pool_max: 200,
};

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

function optionalLabel(record: Record<string, unknown>, id: string): string {
  const value = record.label;
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return id.replace(/-/g, ' ');
}

function readLimit(record: Record<string, unknown>): number {
  const value = record.limit;
  if (value === undefined || value === null || value === '') {
    return DEFAULT_RAIL_LIMIT;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('rail.limit must be a positive integer');
  }
  return Math.min(limit, MAX_RAIL_LIMIT);
}

function readEnabled(record: Record<string, unknown>): boolean {
  return record.enabled !== false;
}

function readTab(record: Record<string, unknown>, contentType: string, context: string): CatalogTab {
  const value = record.tab;
  if (value === undefined || value === null || value === '') {
    return contentType === 'series' ? 'series' : 'movies';
  }
  if (typeof value !== 'string' || !CATALOG_TABS.has(value.trim() as CatalogTab)) {
    throw new Error(`${context}.tab must be movies, series, or live`);
  }
  return value.trim() as CatalogTab;
}

function readWeight(value: unknown, context: string): number {
  if (value === undefined || value === null || value === '') {
    return 1;
  }
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`${context}.weight must be a positive number`);
  }
  return weight;
}

function readSources(record: Record<string, unknown>, context: string): CatalogSourceRef[] {
  const raw = record.sources;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${context}.sources must be a non-empty array`);
  }
  return raw.map((entry, index) => {
    const sourceContext = `${context}.sources[${index}]`;
    const source = asRecord(entry, sourceContext);
    return {
      addon: readString(source, 'addon', sourceContext),
      catalog: readString(source, 'catalog', sourceContext),
      weight: readWeight(source.weight, sourceContext),
    };
  });
}

function readPositiveInteger(
  record: Record<string, unknown>,
  key: keyof RailPlayabilityConfig,
  fallback: number,
  context: string,
): number {
  const value = record[key];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${context}.${key} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  key: keyof RailPlayabilityConfig,
  fallback: number,
  context: string,
): number {
  const value = record[key];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${context}.${key} must be a non-negative integer`);
  }
  return parsed;
}

function readPlayability(record: Record<string, unknown>, context: string): RailPlayabilityConfig {
  const raw = record.playability;
  if (raw === undefined || raw === null) {
    return { ...DEFAULT_PLAYABILITY_CONFIG };
  }
  const playability = asRecord(raw, `${context}.playability`);
  const config = {
    display_limit: readPositiveInteger(
      playability,
      'display_limit',
      DEFAULT_PLAYABILITY_CONFIG.display_limit,
      `${context}.playability`,
    ),
    display_max: readPositiveInteger(
      playability,
      'display_max',
      DEFAULT_PLAYABILITY_CONFIG.display_max,
      `${context}.playability`,
    ),
    min_display: readPositiveInteger(
      playability,
      'min_display',
      DEFAULT_PLAYABILITY_CONFIG.min_display,
      `${context}.playability`,
    ),
    ingest_multiplier: readPositiveInteger(
      playability,
      'ingest_multiplier',
      DEFAULT_PLAYABILITY_CONFIG.ingest_multiplier,
      `${context}.playability`,
    ),
    pool_target: readPositiveInteger(
      playability,
      'pool_target',
      DEFAULT_PLAYABILITY_CONFIG.pool_target,
      `${context}.playability`,
    ),
    pool_growth_per_refresh: readNonNegativeInteger(
      playability,
      'pool_growth_per_refresh',
      DEFAULT_PLAYABILITY_CONFIG.pool_growth_per_refresh,
      `${context}.playability`,
    ),
    pool_max: readPositiveInteger(
      playability,
      'pool_max',
      DEFAULT_PLAYABILITY_CONFIG.pool_max,
      `${context}.playability`,
    ),
  };
  if (config.min_display > config.display_limit) {
    throw new Error(`${context}.playability.min_display must be <= display_limit`);
  }
  if (config.display_max < config.display_limit) {
    throw new Error(`${context}.playability.display_max must be >= display_limit`);
  }
  if (config.pool_target < config.min_display) {
    throw new Error(`${context}.playability.pool_target must be >= min_display`);
  }
  if (config.pool_max < config.pool_target) {
    throw new Error(`${context}.playability.pool_max must be >= pool_target`);
  }
  return config;
}

function readBrowsableRail(
  record: Record<string, unknown>,
  context: string,
  type: 'addon_catalog' | 'composite_list',
): BrowsableRail {
  const id = readString(record, 'id', context);
  const label = optionalLabel(record, id);
  const content_type = readString(record, 'content_type', context);
  const base = {
    id,
    label,
    tab: readTab(record, content_type, context),
    content_type,
    limit: readLimit(record),
    playability: readPlayability(record, context),
    enabled: true as const,
  };

  if (type === 'addon_catalog') {
    return {
      ...base,
      type,
      addon: readString(record, 'addon', context),
      catalog: readString(record, 'catalog', context),
    };
  }

  return {
    ...base,
    type,
    sources: readSources(record, context),
  };
}

function readRail(value: unknown, index: number): RailDefinition {
  const context = `rails[${index}]`;
  const record = asRecord(value, context);
  const id = readString(record, 'id', context);
  const type = readString(record, 'type', context) as RailType;
  const enabled = readEnabled(record);
  const label = optionalLabel(record, id);

  if (!enabled) {
    return { id, label, type, enabled: false };
  }

  if (type === 'addon_catalog' || type === 'composite_list') {
    return readBrowsableRail(record, context, type);
  }

  throw new Error(`${context}.type ${type} is not enabled for browse rails`);
}

export async function loadRailConfig(
  path = process.env.MANGO_CATALOG_YAML || DEFAULT_CATALOG_PATH,
): Promise<RailConfig> {
  const raw = await readFile(path, 'utf8');
  const parsed = asRecord(parseYaml(raw), path);
  const version = Number(parsed.version ?? 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('catalog version must be a positive integer');
  }
  if (!Array.isArray(parsed.rails)) {
    throw new Error('catalog rails must be an array');
  }

  const rails = parsed.rails.map(readRail);
  const seen = new Set<string>();
  for (const rail of rails) {
    if (seen.has(rail.id)) {
      throw new Error(`duplicate rail id: ${rail.id}`);
    }
    seen.add(rail.id);
  }
  return { version, rails };
}

export function enabledBrowsableRails(config: RailConfig): BrowsableRail[] {
  return config.rails.filter((rail): rail is BrowsableRail => (
    rail.enabled && (rail.type === 'addon_catalog' || rail.type === 'composite_list')
  ));
}

export function enabledBrowsableRailsForTab(
  config: RailConfig,
  tab?: CatalogTab,
): BrowsableRail[] {
  const rails = enabledBrowsableRails(config);
  if (!tab) {
    return rails;
  }
  return rails.filter((rail) => rail.tab === tab);
}

export function parseCatalogTab(value: string | null | undefined): CatalogTab | undefined {
  if (!value) {
    return undefined;
  }
  const tab = value.trim() as CatalogTab;
  return CATALOG_TABS.has(tab) ? tab : undefined;
}

export function railSourceSummary(rail: BrowsableRail): CatalogSourceRef[] {
  if (rail.type === 'addon_catalog') {
    return [{ addon: rail.addon, catalog: rail.catalog, weight: 1 }];
  }
  return rail.sources;
}

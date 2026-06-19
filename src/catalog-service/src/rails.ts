import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export type RailType = 'addon_catalog' | 'stremio_library' | 'tmdb_list' | 'static_ids';

export type RailPlayabilityConfig = {
  display_limit: number;
  min_display: number;
  ingest_multiplier: number;
  pool_target: number;
};

export type AddonCatalogRail = {
  id: string;
  label: string;
  type: 'addon_catalog';
  addon: string;
  catalog: string;
  content_type: string;
  limit: number;
  playability: RailPlayabilityConfig;
  enabled: boolean;
};

export type DisabledRail = {
  id: string;
  label: string;
  type: RailType;
  enabled: false;
};

export type RailDefinition = AddonCatalogRail | DisabledRail;

export type RailConfig = {
  version: number;
  rails: RailDefinition[];
};

const DEFAULT_CATALOG_PATH = '/etc/mango/catalog.yaml';
const DEFAULT_RAIL_LIMIT = 20;
const MAX_RAIL_LIMIT = 50;
export const DEFAULT_PLAYABILITY_CONFIG: RailPlayabilityConfig = {
  display_limit: 12,
  min_display: 8,
  ingest_multiplier: 5,
  pool_target: 60,
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
  };
  if (config.min_display > config.display_limit) {
    throw new Error(`${context}.playability.min_display must be <= display_limit`);
  }
  if (config.pool_target < config.min_display) {
    throw new Error(`${context}.playability.pool_target must be >= min_display`);
  }
  return config;
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

  if (type !== 'addon_catalog') {
    throw new Error(`${context}.type ${type} is not enabled for N2`);
  }

  return {
    id,
    label,
    type,
    addon: readString(record, 'addon', context),
    catalog: readString(record, 'catalog', context),
    content_type: readString(record, 'content_type', context),
    limit: readLimit(record),
    playability: readPlayability(record, context),
    enabled: true,
  };
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

export function enabledAddonRails(config: RailConfig): AddonCatalogRail[] {
  return config.rails.filter((rail): rail is AddonCatalogRail => (
    rail.enabled && rail.type === 'addon_catalog'
  ));
}

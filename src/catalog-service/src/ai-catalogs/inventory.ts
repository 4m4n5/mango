import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type MdbListCatalogRow = {
  catalog_id: string;
  slug?: string;
  name?: string;
  media?: string;
  items?: number;
  tags?: string[];
  popularity?: number | null;
  hit_rate?: {
    source?: number;
    status?: string;
    pool_verified?: number;
  };
  rails?: string[];
};

export type MdbListInventory = {
  catalogs: MdbListCatalogRow[];
};

export type AiCatalogReserve = {
  catalogs: Array<{
    id: string;
    tags?: string[];
    priority?: number;
  }>;
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveRepoRoot(): string {
  if (process.env.MANGO_REPO_DIR?.trim()) {
    return process.env.MANGO_REPO_DIR.trim();
  }
  return path.resolve(MODULE_DIR, '../../../..');
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadMdbListInventory(): MdbListInventory {
  const candidates = [
    process.env.MANGO_MDBLIST_INVENTORY?.trim(),
    path.join(resolveRepoRoot(), 'config/mdblist-inventory.json'),
    '/etc/mango/mdblist-inventory.json',
  ].filter((value): value is string => Boolean(value));

  for (const filePath of candidates) {
    const data = readJsonFile<MdbListInventory>(filePath);
    if (data?.catalogs?.length) {
      return data;
    }
  }
  return { catalogs: [] };
}

export function loadAiCatalogReserve(): AiCatalogReserve {
  const candidates = [
    process.env.MANGO_AI_CATALOG_RESERVE?.trim(),
    path.join(resolveRepoRoot(), 'config/ai-catalog-reserve.json'),
    '/etc/mango/ai-catalog-reserve.json',
  ].filter((value): value is string => Boolean(value));

  for (const filePath of candidates) {
    const data = readJsonFile<AiCatalogReserve>(filePath);
    if (data?.catalogs?.length) {
      return data;
    }
  }
  return { catalogs: [] };
}

export function reserveCatalogIds(reserve: AiCatalogReserve = loadAiCatalogReserve()): Set<string> {
  return new Set(reserve.catalogs.map((row) => row.id));
}

export function deployedCatalogIds(inventory: MdbListInventory): Set<string> {
  const ids = new Set<string>();
  for (const row of inventory.catalogs) {
    const tags = row.tags ?? [];
    if (tags.includes('deployed') || (row.rails?.length ?? 0) > 0) {
      ids.add(row.catalog_id);
    }
  }
  return ids;
}

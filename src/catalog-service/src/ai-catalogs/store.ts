import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  DEFAULT_PLAYABILITY_CONFIG,
  type CatalogTab,
} from '../rails.js';
import type { AiCatalogRail, AiCatalogSlotFile } from './types.js';
import { AI_CATALOG_RAIL_PREFIX, MAX_AI_SLOTS_PER_TAB } from './types.js';

const DEFAULT_DIR = '/etc/mango/ai-catalogs';
const SLOTS_SUBDIR = 'slots';

function catalogRoot(): string {
  return (process.env.MANGO_AI_CATALOGS_DIR || DEFAULT_DIR).trim() || DEFAULT_DIR;
}

function slotsDir(): string {
  return path.join(catalogRoot(), SLOTS_SUBDIR);
}

function slotPath(slotId: string): string {
  const bare = slotId.startsWith(AI_CATALOG_RAIL_PREFIX)
    ? slotId.slice(AI_CATALOG_RAIL_PREFIX.length)
    : slotId;
  return path.join(slotsDir(), `${bare}.yaml`);
}

function railIdForSlot(slotId: string): string {
  return slotId.startsWith(AI_CATALOG_RAIL_PREFIX) ? slotId : `${AI_CATALOG_RAIL_PREFIX}${slotId}`;
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

function readSlot(value: unknown, filePath: string): AiCatalogSlotFile {
  const record = asRecord(value, filePath);
  const slot_id = readString(record, 'slot_id', filePath);
  const tab = readString(record, 'tab', filePath) as CatalogTab;
  if (tab !== 'movies' && tab !== 'series') {
    throw new Error(`${filePath}.tab must be movies or series`);
  }
  const content_type = readString(record, 'content_type', filePath);
  if (content_type !== 'movie' && content_type !== 'series') {
    throw new Error(`${filePath}.content_type must be movie or series`);
  }
  const version = Number(record.version ?? 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${filePath}.version must be a positive integer`);
  }

  const sourcesRaw = record.sources;
  const sources = Array.isArray(sourcesRaw)
    ? sourcesRaw.map((entry, index) => {
      const source = asRecord(entry, `${filePath}.sources[${index}]`);
      return {
        addon: readString(source, 'addon', `${filePath}.sources[${index}]`),
        catalog: readString(source, 'catalog', `${filePath}.sources[${index}]`),
        weight: Number(source.weight ?? 1) || 1,
      };
    })
    : [];

  const seedRaw = record.seed_titles;
  const seed_titles = Array.isArray(seedRaw)
    ? seedRaw.map((entry, index) => {
      const seed = asRecord(entry, `${filePath}.seed_titles[${index}]`);
      return {
        type: readString(seed, 'type', `${filePath}.seed_titles[${index}]`),
        id: readString(seed, 'id', `${filePath}.seed_titles[${index}]`),
        title: typeof seed.title === 'string' ? seed.title.trim() : undefined,
        poster: typeof seed.poster === 'string' ? seed.poster.trim() : undefined,
        score: Number.isFinite(Number(seed.score)) ? Number(seed.score) : undefined,
      };
    })
    : [];

  const hintsRaw = record.llm_hints;
  const llm_hints = typeof hintsRaw === 'object' && hintsRaw !== null && !Array.isArray(hintsRaw)
    ? hintsRaw as AiCatalogSlotFile['llm_hints']
    : undefined;

  const playability = typeof record.playability === 'object' && record.playability !== null && !Array.isArray(record.playability)
    ? record.playability as AiCatalogSlotFile['playability']
    : undefined;

  return {
    version,
    slot_id,
    tab,
    label: typeof record.label === 'string' && record.label.trim()
      ? record.label.trim()
      : slot_id.replace(/-/g, ' '),
    content_type: content_type as 'movie' | 'series',
    enabled: record.enabled !== false,
    sources,
    seed_titles,
    llm_hints,
    playability,
  };
}

export function slotToRail(slot: AiCatalogSlotFile): AiCatalogRail {
  return {
    type: 'ai_catalog',
    id: railIdForSlot(slot.slot_id),
    label: slot.label,
    tab: slot.tab,
    content_type: slot.content_type,
    limit: 20,
    playability: {
      ...DEFAULT_PLAYABILITY_CONFIG,
      ...(slot.playability ?? {}),
    },
    enabled: true,
    sources: slot.sources ?? [],
    seed_titles: slot.seed_titles ?? [],
    llm_hints: slot.llm_hints ?? {},
  };
}

export async function ensureAiCatalogDirs(): Promise<void> {
  await mkdir(slotsDir(), { recursive: true });
}

export async function loadAiCatalogSlots(): Promise<AiCatalogSlotFile[]> {
  const dir = slotsDir();
  try {
    const names = await readdir(dir);
    const slots: AiCatalogSlotFile[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
      const filePath = path.join(dir, name);
      const raw = await readFile(filePath, 'utf8');
      slots.push(readSlot(parseYaml(raw), filePath));
    }
    return slots.filter((slot) => slot.enabled);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function loadAiCatalogRails(): Promise<AiCatalogRail[]> {
  const slots = await loadAiCatalogSlots();
  return slots.map(slotToRail);
}

export async function readAiCatalogSlot(slotId: string): Promise<AiCatalogSlotFile | null> {
  try {
    const raw = await readFile(slotPath(slotId), 'utf8');
    return readSlot(parseYaml(raw), slotPath(slotId));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function slotsForTab(slots: AiCatalogSlotFile[], tab: CatalogTab): AiCatalogSlotFile[] {
  return slots.filter((slot) => slot.tab === tab);
}

export function tabHasCapacity(slots: AiCatalogSlotFile[], tab: CatalogTab): boolean {
  return slotsForTab(slots, tab).length < MAX_AI_SLOTS_PER_TAB;
}

export async function writeAiCatalogSlot(slot: AiCatalogSlotFile): Promise<AiCatalogSlotFile> {
  await ensureAiCatalogDirs();
  const payload: AiCatalogSlotFile = {
    ...slot,
    version: slot.version || 1,
  };
  await writeFile(slotPath(slot.slot_id), stringifyYaml(payload), 'utf8');
  return payload;
}

export async function deleteAiCatalogSlot(slotId: string): Promise<boolean> {
  try {
    await unlink(slotPath(slotId));
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function aiCatalogRootPath(): string {
  return catalogRoot();
}

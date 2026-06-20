import { readFile, stat } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { seriesBareId } from './ids.js';
import { titleKey } from './session-select.js';

export type RailCurationPin = {
  rail_id: string;
  type: string;
  id: string;
  label?: string;
  score: number;
  skip_title_filter: boolean;
  session_slot: number | null;
  verify_probe: boolean;
};

export type RailCurationBlock = {
  rail_id: string | null;
  type: string;
  id: string;
  reason?: string;
};

export type RailCurationOverrides = {
  version: number;
  pins: RailCurationPin[];
  blocks: RailCurationBlock[];
};

const DEFAULT_PATHS = [
  '/etc/mango/rail-curation-overrides.yaml',
];

let cached: { path: string; mtimeMs: number; data: RailCurationOverrides } | null = null;

function repoOverridePath(): string {
  return new URL('../../../../config/rail-curation-overrides.example.yaml', import.meta.url).pathname;
}

export function railCurationOverridesPath(): string {
  if (process.env.MANGO_RAIL_CURATION_OVERRIDES?.trim()) {
    return process.env.MANGO_RAIL_CURATION_OVERRIDES.trim();
  }
  return DEFAULT_PATHS[0];
}

async function resolveOverridesPath(): Promise<string | null> {
  const candidates = [
    process.env.MANGO_RAIL_CURATION_OVERRIDES?.trim(),
    ...DEFAULT_PATHS,
    repoOverridePath(),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeId(type: string, id: string): string {
  const trimmed = id.trim();
  if (type === 'series') {
    return seriesBareId(trimmed) ?? trimmed;
  }
  return trimmed;
}

function readPin(raw: Record<string, unknown>, context: string): RailCurationPin {
  const railId = String(raw.rail_id ?? '').trim();
  const type = String(raw.type ?? '').trim();
  const id = normalizeId(type, String(raw.id ?? '').trim());
  if (!railId || !type || !id) {
    throw new Error(`${context}: pin requires rail_id, type, id`);
  }
  const score = Number(raw.score ?? 9999);
  return {
    rail_id: railId,
    type,
    id,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    score: Number.isFinite(score) ? score : 9999,
    skip_title_filter: raw.skip_title_filter !== false,
    session_slot: raw.session_slot === undefined || raw.session_slot === null
      ? null
      : Number(raw.session_slot),
    verify_probe: raw.verify_probe === true,
  };
}

function readBlock(raw: Record<string, unknown>, context: string): RailCurationBlock {
  const type = String(raw.type ?? '').trim();
  const id = normalizeId(type, String(raw.id ?? '').trim());
  if (!type || !id) {
    throw new Error(`${context}: block requires type, id`);
  }
  const railRaw = raw.rail_id;
  const railId = railRaw === undefined || railRaw === null || railRaw === '*'
    ? null
    : String(railRaw).trim();
  return {
    rail_id: railId || null,
    type,
    id,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  };
}

export function parseRailCurationOverrides(text: string): RailCurationOverrides {
  const raw = parseYaml(text);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('rail curation overrides must be a mapping');
  }
  const record = raw as Record<string, unknown>;
  const pins = Array.isArray(record.pins)
    ? record.pins.map((item, index) => readPin(
      item as Record<string, unknown>,
      `pins[${index}]`,
    ))
    : [];
  const blocks = Array.isArray(record.blocks)
    ? record.blocks.map((item, index) => readBlock(
      item as Record<string, unknown>,
      `blocks[${index}]`,
    ))
    : [];
  return {
    version: Number(record.version ?? 1),
    pins,
    blocks,
  };
}

export async function loadRailCurationOverrides(
  force = false,
): Promise<RailCurationOverrides> {
  const path = await resolveOverridesPath();
  if (!path) {
    cached = null;
    return { version: 1, pins: [], blocks: [] };
  }
  const fileStat = await stat(path);
  if (
    !force
    && cached
    && cached.path === path
    && cached.mtimeMs === fileStat.mtimeMs
  ) {
    return cached.data;
  }
  const data = parseRailCurationOverrides(await readFile(path, 'utf8'));
  cached = { path, mtimeMs: fileStat.mtimeMs, data };
  return data;
}

export function shouldSkipTitleFilter(
  type: string,
  id: string,
  overrides: RailCurationOverrides,
): boolean {
  const bare = type === 'series' ? (seriesBareId(id) ?? id) : id;
  return overrides.pins.some(
    (pin) => pin.skip_title_filter
      && pin.type === type
      && (pin.id === id || pin.id === bare),
  );
}

export function pinsForRail(
  railId: string,
  overrides: RailCurationOverrides,
): RailCurationPin[] {
  return overrides.pins.filter((pin) => pin.rail_id === railId);
}

export function isBlockedOnRail(
  railId: string,
  type: string,
  id: string,
  overrides: RailCurationOverrides,
): boolean {
  const key = titleKey(type, id);
  const bare = type === 'series' ? seriesBareId(id) : null;
  return overrides.blocks.some((block) => {
    if (block.rail_id !== null && block.rail_id !== railId) {
      return false;
    }
    const blockKey = titleKey(block.type, block.id);
    if (blockKey === key) return true;
    if (bare && block.type === 'series' && block.id === bare) return true;
    return false;
  });
}

export function mergePinnedPoolItems<T extends { type: string; id: string; score: number }>(
  pool: T[],
  railId: string,
  overrides: RailCurationOverrides,
): T[] {
  const pins = pinsForRail(railId, overrides);
  if (pins.length === 0) {
    return pool.filter((item) => !isBlockedOnRail(railId, item.type, item.id, overrides));
  }
  const blocked = pool.filter((item) => !isBlockedOnRail(railId, item.type, item.id, overrides));
  const byKey = new Map(blocked.map((item) => [titleKey(item.type, item.id), item]));
  for (const pin of pins) {
    const key = titleKey(pin.type, pin.id);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, score: Math.max(existing.score, pin.score) });
    } else {
      byKey.set(key, { type: pin.type, id: pin.id, score: pin.score } as T);
    }
  }
  return [...byKey.values()].sort((left, right) => right.score - left.score);
}

export function injectPinnedSessionItems<T extends { type: string; id: string }>(
  selected: T[],
  pool: T[],
  railId: string,
  overrides: RailCurationOverrides,
  displayLimit: number,
): T[] {
  const pins = [...pinsForRail(railId, overrides)].sort((left, right) => {
    const leftSlot = left.session_slot ?? 0;
    const rightSlot = right.session_slot ?? 0;
    return leftSlot - rightSlot;
  });
  if (pins.length === 0) {
    return selected.slice(0, displayLimit);
  }
  const poolByKey = new Map(pool.map((item) => [titleKey(item.type, item.id), item]));
  const chosen = new Map<string, T>();
  for (const item of selected) {
    chosen.set(titleKey(item.type, item.id), item);
  }
  const ordered: T[] = [];
  for (const pin of pins) {
    const key = titleKey(pin.type, pin.id);
    const item = poolByKey.get(key) ?? chosen.get(key) ?? { type: pin.type, id: pin.id } as T;
    ordered.push(item);
    chosen.delete(key);
  }
  for (const item of selected) {
    const key = titleKey(item.type, item.id);
    if (!chosen.has(key)) continue;
    ordered.push(item);
    chosen.delete(key);
  }
  return ordered.slice(0, displayLimit);
}

export function invalidateRailCurationCache(): void {
  cached = null;
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CatalogTab } from './rails.js';
import { seriesBareId } from './playability/ids.js';

export type UserPin = {
  tab: CatalogTab;
  type: string;
  id: string;
  title: string;
  poster: string;
  pinned_at: number;
};

type UserPinsFile = {
  version: number;
  pins: UserPin[];
};

function pinsPath(): string {
  return process.env.MANGO_USER_PINS_PATH?.trim()
    || path.join(process.env.HOME || '/tmp', '.config/mango/user-pins.json');
}

function normalizePinId(type: string, id: string): string {
  const trimmed = id.trim();
  if (type === 'series') {
    return seriesBareId(trimmed) ?? trimmed;
  }
  return trimmed;
}

async function readPinsFile(): Promise<UserPinsFile> {
  try {
    const raw = JSON.parse(await readFile(pinsPath(), 'utf8')) as UserPinsFile;
    if (!raw || !Array.isArray(raw.pins)) {
      return { version: 1, pins: [] };
    }
    return { version: 1, pins: raw.pins };
  } catch {
    return { version: 1, pins: [] };
  }
}

async function writePinsFile(data: UserPinsFile): Promise<void> {
  const filePath = pinsPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function listUserPins(tab?: CatalogTab): Promise<UserPin[]> {
  const data = await readPinsFile();
  const pins = data.pins
    .filter((pin) => pin.tab && pin.type && pin.id)
    .sort((left, right) => right.pinned_at - left.pinned_at);
  if (!tab) {
    return pins;
  }
  return pins.filter((pin) => pin.tab === tab);
}

export async function addUserPin(input: {
  tab: CatalogTab;
  type: string;
  id: string;
  title?: string;
  poster?: string;
}): Promise<UserPin> {
  const type = input.type.trim();
  const id = normalizePinId(type, input.id);
  if (!type || !id) {
    throw new Error('pin requires type and id');
  }
  const data = await readPinsFile();
  const now = Date.now();
  const next: UserPin = {
    tab: input.tab,
    type,
    id,
    title: (input.title || id).trim(),
    poster: (input.poster || '').trim(),
    pinned_at: now,
  };
  data.pins = [
    next,
    ...data.pins.filter(
      (pin) => !(pin.tab === input.tab && pin.type === type && normalizePinId(pin.type, pin.id) === id),
    ),
  ];
  await writePinsFile(data);
  return next;
}

export async function removeUserPin(input: {
  tab: CatalogTab;
  type: string;
  id: string;
}): Promise<boolean> {
  const type = input.type.trim();
  const id = normalizePinId(type, input.id);
  const data = await readPinsFile();
  const before = data.pins.length;
  data.pins = data.pins.filter(
    (pin) => !(pin.tab === input.tab && pin.type === type && normalizePinId(pin.type, pin.id) === id),
  );
  if (data.pins.length === before) {
    return false;
  }
  await writePinsFile(data);
  return true;
}

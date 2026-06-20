import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const CANCEL_PATH = process.env.MANGO_PLAY_CANCEL_PATH
  || `${process.env.HOME || '/home/aman'}/.cache/mango/play-cancel.epoch`;

let memoryEpoch = 0;

async function ensureDir(): Promise<void> {
  await mkdir(dirname(CANCEL_PATH), { recursive: true });
}

export async function readPlayEpoch(): Promise<number> {
  try {
    const raw = await readFile(CANCEL_PATH, 'utf8');
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      memoryEpoch = parsed;
      return parsed;
    }
  } catch {
    // missing file — use in-process epoch
  }
  return memoryEpoch;
}

/** Invalidate in-flight play attempts (mpv-stop, detail back, new play). */
export async function bumpPlayEpoch(): Promise<number> {
  const next = Math.max(memoryEpoch, Date.now());
  memoryEpoch = next;
  await ensureDir();
  await writeFile(CANCEL_PATH, `${next}\n`, 'utf8');
  return next;
}

export async function isPlayEpochStale(epoch: number): Promise<boolean> {
  return (await readPlayEpoch()) !== epoch;
}

export class PlayCancelledError extends Error {
  constructor() {
    super('play cancelled');
    this.name = 'PlayCancelledError';
  }
}

export async function assertPlayEpoch(epoch: number): Promise<void> {
  if (await isPlayEpochStale(epoch)) {
    throw new PlayCancelledError();
  }
}

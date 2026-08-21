import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

let memoryEpoch = 0;
let epochWriteChain: Promise<void> = Promise.resolve();

function cancelPath(): string {
  return process.env.MANGO_PLAY_CANCEL_PATH
    || `${process.env.HOME || '/home/aman'}/.cache/mango/play-cancel.epoch`;
}

export async function readPlayEpoch(): Promise<number> {
  await epochWriteChain;
  try {
    const raw = await readFile(cancelPath(), 'utf8');
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      memoryEpoch = Math.max(memoryEpoch, parsed);
      return memoryEpoch;
    }
  } catch {
    // missing file — use in-process epoch
  }
  return memoryEpoch;
}

/** Invalidate in-flight play attempts (mpv-stop, detail back, new play). */
export async function bumpPlayEpoch(): Promise<number> {
  // Date.now() can repeat within the same millisecond. Every new play/cancel
  // must still supersede the prior request deterministically.
  const next = Math.max(memoryEpoch + 1, Date.now());
  memoryEpoch = next;
  const path = cancelPath();
  const pendingWrite = epochWriteChain.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${next}\n`, 'utf8');
  });
  epochWriteChain = pendingWrite.catch(() => undefined);
  await pendingWrite;
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

export async function guardPlayMutation<T>(
  epoch: number,
  mutation: () => Promise<T> | T,
  assertCurrent: (value: number) => Promise<void> = assertPlayEpoch,
): Promise<T> {
  await assertCurrent(epoch);
  return mutation();
}

export async function resetPlayEpochForTest(epoch = 0): Promise<void> {
  await epochWriteChain;
  memoryEpoch = epoch;
  epochWriteChain = Promise.resolve();
}

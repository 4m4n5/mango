import { bumpPlayEpoch, readPlayEpoch } from './play-cancel.js';

const activeRequests = new Map<string, number>();

export function normalizePlayRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const requestId = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) return null;
  return requestId;
}

export function registerPlayRequest(requestId: string | null, epoch: number): void {
  if (requestId) activeRequests.set(requestId, epoch);
}

export function finishPlayRequest(requestId: string | null, epoch: number): void {
  if (requestId && activeRequests.get(requestId) === epoch) {
    activeRequests.delete(requestId);
  }
}

export async function cancelPlayRequest(requestId: string | null): Promise<{
  cancelled: boolean;
  epoch: number;
}> {
  if (!requestId) {
    return { cancelled: true, epoch: await bumpPlayEpoch() };
  }
  const requestEpoch = activeRequests.get(requestId);
  const currentEpoch = await readPlayEpoch();
  if (requestEpoch === undefined || requestEpoch !== currentEpoch) {
    return { cancelled: false, epoch: currentEpoch };
  }
  activeRequests.delete(requestId);
  return { cancelled: true, epoch: await bumpPlayEpoch() };
}

export function resetPlayRequestRegistryForTest(): void {
  activeRequests.clear();
}

export function activePlayRequestEpochForTest(requestId: string): number | undefined {
  return activeRequests.get(requestId);
}

import { bumpPlayEpoch, readPlayEpoch } from './play-cancel.js';

const activeRequests = new Map<string, number>();
const finishedSuccessfulRequests = new Set<string>();

export function normalizePlayRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const requestId = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) return null;
  return requestId;
}

export function registerPlayRequest(requestId: string | null, epoch: number): void {
  if (requestId) {
    // A new couch play supersedes any older return proof. Old launcher tokens
    // already ignore their results, and retaining them would make an inactive
    // request ambiguous to the cancellation endpoint.
    finishedSuccessfulRequests.clear();
    activeRequests.set(requestId, epoch);
  }
}

export function finishPlayRequest(requestId: string | null, epoch: number, succeeded = false): void {
  if (requestId && activeRequests.get(requestId) === epoch) {
    activeRequests.delete(requestId);
    if (succeeded) {
      finishedSuccessfulRequests.add(requestId);
    }
  }
}

export async function cancelPlayRequest(requestId: string | null): Promise<{
  cancelled: boolean;
  finished_successfully: boolean;
  epoch: number;
}> {
  if (!requestId) {
    finishedSuccessfulRequests.clear();
    return { cancelled: true, finished_successfully: false, epoch: await bumpPlayEpoch() };
  }
  const requestEpoch = activeRequests.get(requestId);
  const currentEpoch = await readPlayEpoch();
  if (requestEpoch === undefined || requestEpoch !== currentEpoch) {
    return {
      cancelled: false,
      finished_successfully: finishedSuccessfulRequests.has(requestId),
      epoch: currentEpoch,
    };
  }
  activeRequests.delete(requestId);
  finishedSuccessfulRequests.delete(requestId);
  return { cancelled: true, finished_successfully: false, epoch: await bumpPlayEpoch() };
}

export function resetPlayRequestRegistryForTest(): void {
  activeRequests.clear();
  finishedSuccessfulRequests.clear();
}

export function activePlayRequestEpochForTest(requestId: string): number | undefined {
  return activeRequests.get(requestId);
}

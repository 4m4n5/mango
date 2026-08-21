import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export type LiveChannelHealthStatus = 'verified' | 'failed' | 'unknown';

export type LiveChannelHealthObservation = {
  source: string;
  channelId: string;
  status: LiveChannelHealthStatus;
  observedAt?: number;
  reason?: string;
};

export type LiveChannelHealthRecord = {
  status: LiveChannelHealthStatus;
  updated_at: number;
  last_success_at?: number;
  last_failure_at?: number;
  reason?: string;
};

export type LiveChannelHealthRegistry = {
  version: 1;
  records: Record<string, LiveChannelHealthRecord>;
};

export type LiveChannelHealthQuery = LiveChannelHealthRecord & {
  key: string;
  status: LiveChannelHealthStatus;
  stale: boolean;
};

export type LiveChannelHealthSummary = {
  total: number;
  verified: number;
  failed: number;
  unknown: number;
  stale: number;
};

const EMPTY_REGISTRY = (): LiveChannelHealthRegistry => ({ version: 1, records: {} });
const REASON_LIMIT = 240;
let writeSequence = 0;
let writeQueue: Promise<void> = Promise.resolve();

export function liveChannelHealthRegistryPath(): string {
  return process.env.MANGO_LIVE_HEALTH_REGISTRY
    || join(homedir(), '.cache/mango/live-channel-health.json');
}

/** Stable opaque identity: the registry never persists source names, channel ids, URLs, or credentials. */
export function liveChannelHealthKey(source: string, channelId: string): string {
  const normalizedSource = source.trim().toLowerCase();
  const normalizedChannelId = channelId.trim();
  if (!normalizedSource || !normalizedChannelId) {
    throw new Error('live health source and channelId must be non-empty');
  }
  return `v1:${createHash('sha256')
    .update(normalizedSource, 'utf8')
    .update('\0', 'utf8')
    .update(normalizedChannelId, 'utf8')
    .digest('hex')}`;
}

export function sanitizeLiveHealthReason(reason: string | undefined): string | undefined {
  if (typeof reason !== 'string') {
    return undefined;
  }
  const sanitized = reason
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(authorization|password|passwd|pass|username|user|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return undefined;
  }
  return sanitized.slice(0, REASON_LIMIT);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseRecord(value: unknown): LiveChannelHealthRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (!['verified', 'failed', 'unknown'].includes(String(raw.status)) || !isTimestamp(raw.updated_at)) {
    return null;
  }
  const record: LiveChannelHealthRecord = {
    status: raw.status as LiveChannelHealthStatus,
    updated_at: raw.updated_at,
  };
  if (isTimestamp(raw.last_success_at)) {
    record.last_success_at = raw.last_success_at;
  }
  if (isTimestamp(raw.last_failure_at)) {
    record.last_failure_at = raw.last_failure_at;
  }
  const reason = sanitizeLiveHealthReason(typeof raw.reason === 'string' ? raw.reason : undefined);
  if (reason) {
    record.reason = reason;
  }
  return record;
}

function parseRegistryText(text: string): LiveChannelHealthRegistry {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return EMPTY_REGISTRY();
  }
  if ((parsed as { version?: unknown }).version !== 1) {
    return EMPTY_REGISTRY();
  }
  const rawRecords = (parsed as { records?: unknown }).records;
  if (!rawRecords || typeof rawRecords !== 'object' || Array.isArray(rawRecords)) {
    return EMPTY_REGISTRY();
  }
  const records: Record<string, LiveChannelHealthRecord> = {};
  for (const [key, value] of Object.entries(rawRecords)) {
    if (!/^v1:[a-f0-9]{64}$/.test(key)) {
      continue;
    }
    const record = parseRecord(value);
    if (record) {
      records[key] = record;
    }
  }
  return { version: 1, records };
}

export async function readLiveChannelHealthRegistry(
  path = liveChannelHealthRegistryPath(),
): Promise<LiveChannelHealthRegistry> {
  try {
    return parseRegistryText(await readFile(path, 'utf8'));
  } catch {
    return EMPTY_REGISTRY();
  }
}

export function readLiveChannelHealthRegistrySync(
  path = liveChannelHealthRegistryPath(),
): LiveChannelHealthRegistry {
  try {
    return parseRegistryText(readFileSync(path, 'utf8'));
  } catch {
    return EMPTY_REGISTRY();
  }
}

async function writeRegistryAtomic(path: string, registry: LiveChannelHealthRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  writeSequence += 1;
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${writeSequence}.tmp`,
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(registry)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.catch(() => undefined).then(operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function recordLiveChannelHealth(
  observation: LiveChannelHealthObservation,
  path = liveChannelHealthRegistryPath(),
): Promise<LiveChannelHealthRecord> {
  return enqueueWrite(async () => {
    const observedAt = observation.observedAt ?? Date.now();
    if (!isTimestamp(observedAt)) {
      throw new Error('live health observedAt must be a non-negative finite timestamp');
    }
    const key = liveChannelHealthKey(observation.source, observation.channelId);
    const registry = await readLiveChannelHealthRegistry(path);
    const previous = registry.records[key];
    const next: LiveChannelHealthRecord = previous
      ? { ...previous }
      : { status: 'unknown', updated_at: observedAt };

    if (observation.status === 'verified') {
      next.last_success_at = Math.max(next.last_success_at ?? 0, observedAt);
    } else if (observation.status === 'failed') {
      next.last_failure_at = Math.max(next.last_failure_at ?? 0, observedAt);
    }

    // A delayed observation may add history, but must not replace newer current state.
    if (!previous || observedAt >= previous.updated_at) {
      next.status = observation.status;
      next.updated_at = observedAt;
      const reason = sanitizeLiveHealthReason(observation.reason);
      if (reason) {
        next.reason = reason;
      } else {
        delete next.reason;
      }
    }

    registry.records[key] = next;
    await writeRegistryAtomic(path, registry);
    return { ...next };
  });
}

function validateFreshness(freshnessHorizonMs: number, now: number): void {
  if (!isTimestamp(freshnessHorizonMs)) {
    throw new Error('live health freshness horizon must be a non-negative finite duration');
  }
  if (!isTimestamp(now)) {
    throw new Error('live health now must be a non-negative finite timestamp');
  }
}

export function queryLiveChannelHealthRecord(
  registry: LiveChannelHealthRegistry,
  source: string,
  channelId: string,
  freshnessHorizonMs: number,
  now = Date.now(),
): LiveChannelHealthQuery {
  validateFreshness(freshnessHorizonMs, now);
  const key = liveChannelHealthKey(source, channelId);
  const record = registry.records[key];
  if (!record) {
    return { key, status: 'unknown', stale: false, updated_at: now };
  }
  const statusTimestamp = record.status === 'verified'
    ? record.last_success_at
    : record.status === 'failed'
      ? record.last_failure_at
      : record.updated_at;
  const stale = statusTimestamp === undefined
    || Math.max(0, now - statusTimestamp) > freshnessHorizonMs;
  if (record.status === 'unknown' || stale) {
    return { ...record, key, status: 'unknown', stale };
  }
  return { ...record, key, stale: false };
}

export async function queryLiveChannelHealth(
  source: string,
  channelId: string,
  freshnessHorizonMs: number,
  options: { now?: number; path?: string } = {},
): Promise<LiveChannelHealthQuery> {
  const registry = await readLiveChannelHealthRegistry(options.path);
  return queryLiveChannelHealthRecord(
    registry,
    source,
    channelId,
    freshnessHorizonMs,
    options.now,
  );
}

export function summarizeLiveChannelHealth(
  registry: LiveChannelHealthRegistry,
  freshnessHorizonMs: number,
  now = Date.now(),
): LiveChannelHealthSummary {
  validateFreshness(freshnessHorizonMs, now);
  const summary: LiveChannelHealthSummary = {
    total: 0,
    verified: 0,
    failed: 0,
    unknown: 0,
    stale: 0,
  };
  for (const record of Object.values(registry.records)) {
    const statusTimestamp = record.status === 'verified'
      ? record.last_success_at
      : record.status === 'failed'
        ? record.last_failure_at
        : record.updated_at;
    const stale = statusTimestamp === undefined
      || Math.max(0, now - statusTimestamp) > freshnessHorizonMs;
    summary.total += 1;
    if (record.status === 'unknown' || stale) {
      summary.unknown += 1;
      if (stale) {
        summary.stale += 1;
      }
    } else {
      summary[record.status] += 1;
    }
  }
  return summary;
}

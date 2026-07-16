import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Stream } from '../core.js';
import { scoreTitleMatch, type VoiceSearchHit } from '../voice/search.js';

/**
 * AREA69 (paid Xtream Codes IPTV) live-channel search + play resolve.
 *
 * The full ~55k-stream catalog is too large for NexoTV to index directly
 * (see scripts/live/build-curated-area69-m3u.py), so a curated M3U ships a
 * small set of browsable channels while a separate full-catalog search index
 * (JSON, built by the same script) lets voice/text search find any AREA69
 * channel by name. Channel ids are namespaced `area69:{stream_id}` so /play
 * can route them straight to the Xtream URL builder below, bypassing NexoTV
 * entirely. Search/playback probes are serialized behind Mango's playback
 * ownership check because AREA69 caps max_connections=1.
 */

export const AREA69_CHANNEL_ID_PREFIX = 'area69:';
export const AREA69_SEARCH_INDEX_VERSION = 2;

export type Area69EventMetadata = {
  event_id?: string | number;
  status?: string;
  starts_at?: string | number;
  ends_at?: string | number;
  competition?: string;
  home?: string;
  away?: string;
};

export type Area69SearchEntry = {
  stream_id: string;
  name: string;
  category_id?: string;
  category?: string;
  logo?: string;
  epg_channel_id?: string;
  kind?: 'channel' | 'event';
  event?: Area69EventMetadata;
};

export type Area69SearchIndex = {
  version?: number;
  built_at?: number;
  source?: string;
  stream_count?: number;
  entries: Area69SearchEntry[];
};

export type Area69Credentials = {
  url: string;
  user: string;
  pass: string;
};

export function isArea69ChannelId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(AREA69_CHANNEL_ID_PREFIX);
}

export function parseArea69StreamId(id: string): string | null {
  if (!isArea69ChannelId(id)) {
    return null;
  }
  const streamId = id.slice(AREA69_CHANNEL_ID_PREFIX.length).trim();
  return streamId || null;
}

export function formatArea69ChannelId(streamId: string): string {
  return `${AREA69_CHANNEL_ID_PREFIX}${streamId}`;
}

function area69SearchIndexPath(): string {
  return process.env.MANGO_AREA69_SEARCH_INDEX
    || join(homedir(), '.local/share/mango/nexotv/data/area69-live-search.json');
}

function area69CredentialsPath(): string {
  return process.env.MANGO_AREA69_CREDS
    || join(homedir(), '.config/mango/area69.credentials');
}

let cachedIndex: Area69SearchIndex | null = null;
let cachedIndexPath: string | null = null;
let cachedIndexMtimeMs = 0;

/** Test-only: force the next load/search to re-read the index file from disk. */
export function clearArea69SearchIndexCache(): void {
  cachedIndex = null;
  cachedIndexPath = null;
  cachedIndexMtimeMs = 0;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function safeEventScalar(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) {
    return undefined;
  }
  const lower = trimmed.toLowerCase();
  if (trimmed.includes('://') || lower.includes('username=') || lower.includes('password=')) {
    return undefined;
  }
  return trimmed;
}

function normalizeEventMetadata(raw: unknown): Area69EventMetadata | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const event: Area69EventMetadata = {};
  const eventId = safeEventScalar(record.event_id);
  const startsAt = safeEventScalar(record.starts_at);
  const endsAt = safeEventScalar(record.ends_at);
  const status = safeEventScalar(record.status);
  const competition = safeEventScalar(record.competition);
  const home = safeEventScalar(record.home);
  const away = safeEventScalar(record.away);
  if (eventId !== undefined) event.event_id = eventId;
  if (startsAt !== undefined) event.starts_at = startsAt;
  if (endsAt !== undefined) event.ends_at = endsAt;
  if (typeof status === 'string') event.status = status;
  if (typeof competition === 'string') event.competition = competition;
  if (typeof home === 'string') event.home = home;
  if (typeof away === 'string') event.away = away;
  return Object.keys(event).length > 0 ? event : undefined;
}

function normalizeEntry(raw: unknown): Area69SearchEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const streamId = optionalString(record, 'stream_id');
  const name = optionalString(record, 'name');
  if (!streamId || !name) {
    return null;
  }
  const entry: Area69SearchEntry = { stream_id: streamId, name };
  const categoryId = optionalString(record, 'category_id');
  const category = optionalString(record, 'category');
  const logo = optionalString(record, 'logo');
  const epgChannelId = optionalString(record, 'epg_channel_id');
  if (categoryId !== undefined) entry.category_id = categoryId;
  if (category !== undefined) entry.category = category;
  if (logo !== undefined) entry.logo = logo;
  if (epgChannelId !== undefined) entry.epg_channel_id = epgChannelId;
  if (record.kind === 'channel' || record.kind === 'event') {
    entry.kind = record.kind;
  }
  const event = normalizeEventMetadata(record.event);
  if (event) entry.event = event;
  return entry;
}

function normalizeEntries(raw: unknown): Area69SearchEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(normalizeEntry).filter((entry): entry is Area69SearchEntry => entry !== null);
}

/** Loads (and memoizes) the AREA69 full-catalog search index. Returns null if missing/invalid. */
export async function loadArea69SearchIndex(): Promise<Area69SearchIndex | null> {
  const path = area69SearchIndexPath();
  if (!existsSync(path)) {
    cachedIndexPath = path;
    cachedIndex = null;
    cachedIndexMtimeMs = 0;
    return null;
  }
  const mtimeMs = statSync(path).mtimeMs;
  if (cachedIndex && cachedIndexPath === path && cachedIndexMtimeMs === mtimeMs) {
    return cachedIndex;
  }
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Area69SearchIndex>;
    if (parsed.version !== AREA69_SEARCH_INDEX_VERSION) {
      cachedIndex = null;
      cachedIndexPath = path;
      cachedIndexMtimeMs = mtimeMs;
      return null;
    }
    const index: Area69SearchIndex = {
      version: parsed.version,
      built_at: parsed.built_at,
      source: parsed.source,
      stream_count: parsed.stream_count,
      entries: normalizeEntries(parsed.entries),
    };
    cachedIndex = index;
    cachedIndexPath = path;
    cachedIndexMtimeMs = mtimeMs;
    return index;
  } catch {
    cachedIndex = null;
    cachedIndexPath = path;
    cachedIndexMtimeMs = 0;
    return null;
  }
}

export async function searchArea69Index(query: string, limit = 8): Promise<VoiceSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const index = await loadArea69SearchIndex();
  if (!index) {
    return [];
  }
  const scored: VoiceSearchHit[] = [];
  for (const entry of index.entries) {
    const score = scoreTitleMatch(entry.name, trimmed);
    if (score <= 0) {
      continue;
    }
    scored.push({
      type: 'tv',
      id: formatArea69ChannelId(entry.stream_id),
      title: entry.name,
      poster: entry.logo,
      tab: 'live',
      score,
    });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.title.localeCompare(right.title);
  });
  return scored.slice(0, Math.max(1, limit));
}

function parseArea69Credentials(raw: string): Area69Credentials | null {
  let url: string | undefined;
  let user: string | undefined;
  let pass: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'XTREAM_URL') {
      url = value;
    } else if (key === 'XTREAM_USER') {
      user = value;
    } else if (key === 'XTREAM_PASS') {
      pass = value;
    }
  }
  if (!url || !user || !pass) {
    return null;
  }
  return { url: url.replace(/\/+$/, ''), user, pass };
}

export async function loadArea69Credentials(): Promise<Area69Credentials | null> {
  const path = area69CredentialsPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseArea69Credentials(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export function buildArea69StreamUrl(creds: Area69Credentials, streamId: string): string {
  return `${creds.url}/live/${creds.user}/${creds.pass}/${streamId}.ts`;
}

export type Area69TaggedChannel = {
  id: string;
  name: string;
  title: string;
  poster?: string;
  description?: string;
  genre?: string;
  releaseInfo?: string;
  category_id?: string;
  event?: Area69EventMetadata;
  source_addon: string;
  source_label: string;
  source_manifest: string;
  source_catalog_type: string;
};

/** Map AREA69 search-index rows into the live-rails channel pool (play via area69:{id}). */
export function area69EntryToTaggedChannel(entry: Area69SearchEntry): Area69TaggedChannel {
  const matchup = entry.event?.home && entry.event?.away
    ? `${entry.event.home} vs ${entry.event.away}`
    : undefined;
  const eventContext = entry.event
    ? [entry.event.competition, matchup, entry.event.status, entry.event.starts_at]
      .filter((value) => value !== undefined && String(value).trim() !== '')
      .map(String)
      .join(' · ')
    : '';
  return {
    id: formatArea69ChannelId(entry.stream_id),
    name: entry.name,
    title: entry.name,
    poster: entry.logo,
    description: eventContext || undefined,
    genre: entry.category,
    releaseInfo: eventContext || entry.category || undefined,
    category_id: entry.category_id,
    event: entry.event,
    source_addon: 'mango Live TV',
    source_label: 'AREA69',
    source_manifest: 'area69-search-index',
    source_catalog_type: 'tv',
  };
}

export async function listArea69TaggedChannels(): Promise<Area69TaggedChannel[]> {
  const index = await loadArea69SearchIndex();
  if (!index?.entries.length) {
    return [];
  }
  return index.entries.map(area69EntryToTaggedChannel);
}

/**
 * Resolve a bare AREA69 stream_id (no `area69:` prefix) to candidate playable
 * streams, built directly from local Xtream credentials. This resolver itself
 * performs no network call; callers own playback-aware reachability/proof.
 */
export async function resolveArea69Streams(streamId: string): Promise<Stream[]> {
  const trimmed = streamId.trim();
  if (!trimmed) {
    return [];
  }
  const creds = await loadArea69Credentials();
  if (!creds) {
    return [];
  }
  return [{
    url: buildArea69StreamUrl(creds, trimmed),
    title: 'AREA69',
    source: 'area69',
  }];
}

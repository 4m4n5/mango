import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRaw, inflateRawSync } from 'node:zlib';
import {
  recordYoutubeV2TakeoutImport,
  upsertYoutubeItems,
  upsertYoutubeV2ImportedHistory,
} from './db.js';
import type { YoutubeItem } from './types.js';

export const YOUTUBE_TAKEOUT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = YOUTUBE_TAKEOUT_MAX_ARCHIVE_BYTES;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_JSON_NODES = 250_000;
const HISTORY_DEDUPE_TOLERANCE_MS = 60_000;
const FAILURE_HASH_SAMPLE_BYTES = 32 * 1024;
const FAILURE_HASH_SAMPLE_STRING_CODE_UNITS = 16 * 1024;

const SAFE_TAKEOUT_AUDIT_ERRORS = new Set([
  'YouTube Takeout JSON is too complex',
  'YouTube Takeout archive is too large or empty',
  'YouTube Takeout archive is too large',
  'YouTube Takeout contained no readable watch history or subscriptions',
  'YouTube Takeout contained no supported JSON or HTML files',
  'YouTube Takeout file is too large',
  'YouTube Takeout input is empty',
  'YouTube Takeout input is too large',
  'corrupt YouTube Takeout ZIP entry',
  'invalid YouTube Takeout ZIP directory length',
  'invalid YouTube Takeout ZIP entry',
  'invalid YouTube Takeout ZIP local entry',
  'invalid YouTube Takeout ZIP',
  'mismatched YouTube Takeout ZIP entry name',
  'truncated YouTube Takeout ZIP entry',
  'unsafe YouTube Takeout ZIP directory',
  'unsafe YouTube Takeout ZIP expansion',
  'unsafe YouTube Takeout archive path',
  'unsupported YouTube Takeout format; choose a ZIP, JSON, or HTML export',
  'unsupported or encrypted YouTube Takeout ZIP entry',
]);

export type YoutubeTakeoutFormat = 'zip' | 'json' | 'html';

export type YoutubeTakeoutSubscription = {
  channel_key: string;
  channel_id: string | null;
  channel_title: string;
  channel_url: string | null;
  subscribed_at: number | null;
};

export type YoutubeTakeoutHistoryEntry = {
  video_id: string;
  title: string;
  title_url: string | null;
  channel_id: string | null;
  channel_title: string | null;
  watched_at: number;
};

export type ParsedYoutubeTakeout = {
  format: YoutubeTakeoutFormat;
  source_generation: string;
  files_read: string[];
  authoritative_subscriptions: boolean;
  subscriptions: YoutubeTakeoutSubscription[];
  history: YoutubeTakeoutHistoryEntry[];
  warnings: string[];
};

type TakeoutFile = { name: string; data: Buffer };

function safeArchiveName(name: string): string {
  const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/')
    || normalized.split('/').some((part) => part === '..')) {
    throw new Error('unsafe YouTube Takeout archive path');
  }
  return normalized;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inflateRawBounded(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    inflateRaw(data, { maxOutputLength: MAX_FILE_BYTES }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function unzipTakeout(archive: Buffer): TakeoutFile[] {
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('YouTube Takeout archive is too large');
  const eocdMin = 22;
  let eocd = -1;
  for (let offset = archive.length - eocdMin; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('invalid YouTube Takeout ZIP');
  const entries = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (entries > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > archive.length) {
    throw new Error('unsafe YouTube Takeout ZIP directory');
  }
  const files: TakeoutFile[] = [];
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('invalid YouTube Takeout ZIP entry');
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > archive.length) throw new Error('invalid YouTube Takeout ZIP entry');
    const name = safeArchiveName(archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    if (/\.(?:json|html?)$/i.test(name)) {
      if ((flags & 0x1) !== 0 || ![0, 8].includes(method)) {
        throw new Error('unsupported or encrypted YouTube Takeout ZIP entry');
      }
      if (uncompressedSize > MAX_FILE_BYTES || total + uncompressedSize > MAX_TOTAL_UNCOMPRESSED_BYTES
        || (compressedSize > 0 && uncompressedSize / compressedSize > 500)) {
        throw new Error('unsafe YouTube Takeout ZIP expansion');
      }
      total += uncompressedSize;
      if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error('invalid YouTube Takeout ZIP local entry');
      }
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const localName = safeArchiveName(
        archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8'),
      );
      if (localName !== name) throw new Error('mismatched YouTube Takeout ZIP entry name');
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > archive.length) throw new Error('truncated YouTube Takeout ZIP entry');
      const compressed = archive.subarray(dataStart, dataEnd);
      const data = method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: MAX_FILE_BYTES });
      if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) {
        throw new Error('corrupt YouTube Takeout ZIP entry');
      }
      files.push({ name, data });
    }
    cursor = end;
  }
  return files;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)));
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function historyTimestampFromHtml(value: string): number | null {
  const text = stripHtml(value);
  const iso = text.match(/\b(?:19|20)\d{2}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}|[A-Z]{2,5}))?)?/i)?.[0];
  const named = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+(?:19|20)\d{2}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?(?:\s+[A-Z]{2,5})?)?/i)?.[0];
  return timestamp(iso ?? named);
}

function videoIdFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(decodeEntities(value));
    const hostname = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (hostname === 'youtu.be') return /^[\w-]{6,20}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return null;
    const fromQuery = url.searchParams.get('v');
    if (fromQuery && /^[\w-]{6,20}$/.test(fromQuery)) return fromQuery;
    const match = url.pathname.match(/\/(?:shorts|live)\/([\w-]{6,20})/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function channelIdentity(value: unknown): { channel_key: string; channel_id: string | null; channel_url: string | null } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(decodeEntities(value));
    const hostname = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol)
      || (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com'))) return null;
    const id = url.pathname.match(/\/channel\/([\w-]+)/)?.[1] ?? null;
    const handle = url.pathname.match(/\/@([^/?#]+)/)?.[1] ?? null;
    const key = id || (handle ? `@${handle.toLowerCase()}` : null);
    return key ? { channel_key: key, channel_id: id, channel_url: url.toString() } : null;
  } catch {
    return null;
  }
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function parseJsonFile(
  name: string,
  data: Buffer,
  subscriptions: YoutubeTakeoutSubscription[],
  history: YoutubeTakeoutHistoryEntry[],
): void {
  const root = JSON.parse(data.toString('utf8')) as unknown;
  const subscriptionFile = /subscription/i.test(name)
    || (root !== null && typeof root === 'object' && !Array.isArray(root) && 'subscriptions' in root);
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    visited += 1;
    if (visited > MAX_JSON_NODES) throw new Error('YouTube Takeout JSON is too complex');
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const titleUrl = typeof row.titleUrl === 'string' ? row.titleUrl : typeof row.url === 'string' ? row.url : null;
    const videoId = videoIdFromUrl(titleUrl);
    if (videoId) {
      const subtitle = Array.isArray(row.subtitles)
        ? row.subtitles.find((entry) => entry && typeof entry === 'object') as Record<string, unknown> | undefined
        : undefined;
      const watchedAt = timestamp(row.time ?? row.watchedAt ?? row.timestamp);
      if (watchedAt) {
        history.push({
          video_id: videoId,
          title: String(row.title ?? videoId).replace(/^Watched\s+/i, '').trim() || videoId,
          title_url: titleUrl,
          channel_id: channelIdentity(subtitle?.url)?.channel_id ?? null,
          channel_title: typeof subtitle?.name === 'string' ? subtitle.name.trim() || null : null,
          watched_at: watchedAt,
        });
      }
    }
    if (subscriptionFile) {
      const snippet = row.snippet && typeof row.snippet === 'object' ? row.snippet as Record<string, unknown> : row;
      const resource = snippet.resourceId && typeof snippet.resourceId === 'object'
        ? snippet.resourceId as Record<string, unknown> : {};
      const rawId = String(row.channelId ?? snippet.channelId ?? resource.channelId ?? '').trim();
      const providedUrl = row.channelUrl ?? row.url;
      const rawUrl = providedUrl ?? (rawId ? `https://www.youtube.com/channel/${rawId}` : null);
      const identity = channelIdentity(rawUrl) || (providedUrl === undefined && rawId
        ? { channel_key: rawId, channel_id: rawId, channel_url: `https://www.youtube.com/channel/${rawId}` }
        : null);
      const title = String(row.channelTitle ?? snippet.title ?? row.title ?? '').trim();
      if (identity && title && !videoId) {
        subscriptions.push({ ...identity, channel_title: title, subscribed_at: timestamp(row.time ?? row.subscribedAt) });
      }
    }
    stack.push(...Object.values(row));
  }
}

function parseHtmlFile(
  name: string,
  data: Buffer,
  subscriptions: YoutubeTakeoutSubscription[],
  history: YoutubeTakeoutHistoryEntry[],
): void {
  const html = data.toString('utf8');
  const subscriptionFile = /subscription/i.test(name);
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  if (subscriptionFile) {
    for (const anchor of anchors) {
      const identity = channelIdentity(anchor[1]);
      const title = stripHtml(anchor[2] ?? '');
      if (identity && title) subscriptions.push({ ...identity, channel_title: title, subscribed_at: null });
    }
    return;
  }
  for (const anchor of anchors) {
    const id = videoIdFromUrl(anchor[1]);
    if (!id) continue;
    const offset = anchor.index ?? 0;
    const context = html.slice(Math.max(0, offset - 500), Math.min(html.length, offset + 1_500));
    const watchedAt = historyTimestampFromHtml(context);
    if (!watchedAt) continue;
    const afterVideo = html.slice(offset + anchor[0].length, Math.min(html.length, offset + 1_000));
    const channelAnchor = [...afterVideo.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((entry) => ({ entry, identity: channelIdentity(entry[1]) }))
      .find((candidate) => candidate.identity !== null);
    history.push({
      video_id: id,
      title: stripHtml(anchor[2] ?? '').replace(/^Watched\s+/i, '').trim() || id,
      title_url: decodeEntities(anchor[1] ?? ''),
      channel_id: channelAnchor?.identity?.channel_id ?? null,
      channel_title: channelAnchor ? stripHtml(channelAnchor.entry[2] ?? '') || null : null,
      watched_at: watchedAt,
    });
  }
}

function normalizedInput(input: Buffer | Uint8Array | string): Buffer {
  if (typeof input === 'string') {
    if (input.length === 0) throw new Error('YouTube Takeout input is empty');
    if (Buffer.byteLength(input, 'utf8') > MAX_ARCHIVE_BYTES) {
      throw new Error('YouTube Takeout input is too large');
    }
    return Buffer.from(input, 'utf8');
  }
  if (input.byteLength === 0) throw new Error('YouTube Takeout input is empty');
  if (input.byteLength > MAX_ARCHIVE_BYTES) throw new Error('YouTube Takeout input is too large');
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

/**
 * Produces an audit identity without normalizing or copying an untrusted input.
 * Small inputs retain their exact content hash. Large inputs use a domain-
 * separated hash of their type, length, and bounded head/tail samples.
 */
function boundedTakeoutFailureHash(input: Buffer | Uint8Array | string): string {
  const hash = createHash('sha256');
  if (typeof input === 'string') {
    if (input.length <= FAILURE_HASH_SAMPLE_STRING_CODE_UNITS * 2) {
      return hash.update(input, 'utf8').digest('hex');
    }
    return hash
      .update('mango-youtube-takeout-failure-string-v1\0')
      .update(String(input.length))
      .update('\0')
      .update(input.slice(0, FAILURE_HASH_SAMPLE_STRING_CODE_UNITS), 'utf8')
      .update('\0')
      .update(input.slice(-FAILURE_HASH_SAMPLE_STRING_CODE_UNITS), 'utf8')
      .digest('hex');
  }

  const bytes = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength <= FAILURE_HASH_SAMPLE_BYTES * 2) {
    return hash.update(bytes).digest('hex');
  }
  return hash
    .update('mango-youtube-takeout-failure-bytes-v1\0')
    .update(String(bytes.byteLength))
    .update('\0')
    .update(bytes.subarray(0, FAILURE_HASH_SAMPLE_BYTES))
    .update(bytes.subarray(-FAILURE_HASH_SAMPLE_BYTES))
    .digest('hex');
}

function safeTakeoutAuditError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return SAFE_TAKEOUT_AUDIT_ERRORS.has(message)
    ? message
    : 'malformed YouTube Takeout input';
}

function takeoutInputFormat(data: Buffer, filename: string | undefined): YoutubeTakeoutFormat {
  const lowerName = filename?.trim().toLowerCase() ?? '';
  const signature = data.length >= 4 ? data.readUInt32LE(0) : 0;
  const hasZipSignature = [0x04034b50, 0x06054b50, 0x08074b50].includes(signature);
  if (hasZipSignature || lowerName.endsWith('.zip')) return 'zip';
  if (lowerName.endsWith('.json')) return 'json';
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'html';
  if (!lowerName || lowerName === 'youtube-takeout') {
    const prefix = data.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
    if (prefix.startsWith('{') || prefix.startsWith('[')) return 'json';
    if (prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<div')) return 'html';
  }
  throw new Error('unsupported YouTube Takeout format; choose a ZIP, JSON, or HTML export');
}

function dedupeHistoryWithinImport(history: YoutubeTakeoutHistoryEntry[]): YoutubeTakeoutHistoryEntry[] {
  const ordered = [...history].sort((left, right) => (
    left.video_id.localeCompare(right.video_id) || left.watched_at - right.watched_at
  ));
  const result: YoutubeTakeoutHistoryEntry[] = [];
  const lastAcceptedByVideo = new Map<string, YoutubeTakeoutHistoryEntry>();
  for (const entry of ordered) {
    const previous = lastAcceptedByVideo.get(entry.video_id);
    if (previous && entry.watched_at - previous.watched_at <= HISTORY_DEDUPE_TOLERANCE_MS) {
      continue;
    }
    result.push(entry);
    lastAcceptedByVideo.set(entry.video_id, entry);
  }
  return result.sort((left, right) => right.watched_at - left.watched_at);
}

type TakeoutParseAccumulator = {
  subscriptions: YoutubeTakeoutSubscription[];
  history: YoutubeTakeoutHistoryEntry[];
  warnings: string[];
  filesRead: string[];
};

function takeoutAccumulator(): TakeoutParseAccumulator {
  return { subscriptions: [], history: [], warnings: [], filesRead: [] };
}

function parseTakeoutFileInto(file: TakeoutFile, accumulator: TakeoutParseAccumulator): void {
  const fileSubscriptions: YoutubeTakeoutSubscription[] = [];
  const fileHistory: YoutubeTakeoutHistoryEntry[] = [];
  try {
    if (/\.json$/i.test(file.name)) {
      parseJsonFile(file.name, file.data, fileSubscriptions, fileHistory);
    } else if (/\.html?$/i.test(file.name)) {
      parseHtmlFile(file.name, file.data, fileSubscriptions, fileHistory);
    }
    accumulator.subscriptions.push(...fileSubscriptions);
    accumulator.history.push(...fileHistory);
    accumulator.filesRead.push(file.name);
  } catch (error) {
    // Archive member names can contain viewer-authored paths. Keep receipts and
    // durable audits useful without echoing those names or raw parser details.
    accumulator.warnings.push(`skipped malformed YouTube Takeout file: ${safeTakeoutAuditError(error)}`);
  }
}

function finishTakeoutParse(
  format: YoutubeTakeoutFormat,
  sourceGeneration: string,
  accumulator: TakeoutParseAccumulator,
): ParsedYoutubeTakeout {
  const uniqueSubscriptions = new Map(
    accumulator.subscriptions.map((row) => [row.channel_key, row] as const),
  );
  const uniqueHistory = dedupeHistoryWithinImport(accumulator.history);
  if (uniqueSubscriptions.size === 0 && uniqueHistory.length === 0) {
    throw new Error('YouTube Takeout contained no readable watch history or subscriptions');
  }
  return {
    format,
    source_generation: sourceGeneration,
    files_read: accumulator.filesRead,
    // Takeout subscriptions are audit-only. OAuth/API complete pagination is
    // the sole authoritative subscription snapshot for recommendation input.
    authoritative_subscriptions: false,
    subscriptions: [...uniqueSubscriptions.values()],
    history: uniqueHistory,
    warnings: accumulator.warnings,
  };
}

export function parseYoutubeTakeout(
  input: Buffer | Uint8Array | string,
  options: { filename?: string } = {},
): ParsedYoutubeTakeout {
  const data = normalizedInput(input);
  const format = takeoutInputFormat(data, options.filename);
  if (format !== 'zip' && data.length > MAX_FILE_BYTES) {
    throw new Error('YouTube Takeout file is too large');
  }
  const sourceGeneration = createHash('sha256').update(data).digest('hex');
  const files = format === 'zip'
    ? unzipTakeout(data)
    : [{ name: safeArchiveName(options.filename || `takeout.${format}`), data }];
  if (files.length === 0) {
    throw new Error('YouTube Takeout contained no supported JSON or HTML files');
  }
  const accumulator = takeoutAccumulator();
  for (const file of files) {
    parseTakeoutFileInto(file, accumulator);
  }
  return finishTakeoutParse(format, sourceGeneration, accumulator);
}

async function readExact(
  handle: FileHandle,
  length: number,
  position: number,
  failure: string,
): Promise<Buffer> {
  if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(position) || position < 0) {
    throw new Error(failure);
  }
  const data = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(data, offset, length - offset, position + offset);
    if (bytesRead <= 0) throw new Error(failure);
    offset += bytesRead;
  }
  return data;
}

async function* streamedZipTakeoutFiles(path: string): AsyncGenerator<TakeoutFile> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_ARCHIVE_BYTES) {
      throw new Error('YouTube Takeout archive is too large or empty');
    }
    const tailLength = Math.min(info.size, 65_557);
    const tail = await readExact(
      handle,
      tailLength,
      info.size - tailLength,
      'invalid YouTube Takeout ZIP',
    );
    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== 0x06054b50 || offset + 22 > tail.length) continue;
      const commentLength = tail.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === tail.length) {
        eocd = offset;
        break;
      }
    }
    if (eocd < 0) throw new Error('invalid YouTube Takeout ZIP');
    const diskEntries = tail.readUInt16LE(eocd + 8);
    const entries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (diskEntries !== entries || entries > MAX_ARCHIVE_ENTRIES
      || centralSize > MAX_FILE_BYTES || centralOffset + centralSize > info.size) {
      throw new Error('unsafe YouTube Takeout ZIP directory');
    }
    const central = await readExact(
      handle,
      centralSize,
      centralOffset,
      'truncated YouTube Takeout ZIP directory',
    );
    let cursor = 0;
    let totalUncompressed = 0;
    for (let index = 0; index < entries; index += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error('invalid YouTube Takeout ZIP entry');
      }
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const expectedCrc = central.readUInt32LE(cursor + 16);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const localOffset = central.readUInt32LE(cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > central.length) throw new Error('invalid YouTube Takeout ZIP entry');
      const name = safeArchiveName(
        central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      );
      cursor = end;
      if (!/\.(?:json|html?)$/i.test(name)) continue;
      if ((flags & 0x1) !== 0 || ![0, 8].includes(method)
        || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
        || localOffset === 0xffffffff) {
        throw new Error('unsupported or encrypted YouTube Takeout ZIP entry');
      }
      if (uncompressedSize > MAX_FILE_BYTES
        || totalUncompressed + uncompressedSize > MAX_TOTAL_UNCOMPRESSED_BYTES
        || (compressedSize > 0 && uncompressedSize / compressedSize > 500)) {
        throw new Error('unsafe YouTube Takeout ZIP expansion');
      }
      totalUncompressed += uncompressedSize;
      const local = await readExact(
        handle,
        30,
        localOffset,
        'invalid YouTube Takeout ZIP local entry',
      );
      if (local.readUInt32LE(0) !== 0x04034b50) {
        throw new Error('invalid YouTube Takeout ZIP local entry');
      }
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      const localName = safeArchiveName((await readExact(
        handle,
        localNameLength,
        localOffset + 30,
        'invalid YouTube Takeout ZIP local name',
      )).toString('utf8'));
      if (localName !== name) throw new Error('mismatched YouTube Takeout ZIP entry name');
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > info.size) {
        throw new Error('truncated YouTube Takeout ZIP entry');
      }
      const compressed = await readExact(
        handle,
        compressedSize,
        dataStart,
        'truncated YouTube Takeout ZIP entry',
      );
      const data = method === 0
        ? compressed
        : await inflateRawBounded(compressed);
      if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) {
        throw new Error('corrupt YouTube Takeout ZIP entry');
      }
      // Yield one bounded file at a time so parsed siblings can be discarded
      // before the next compressed member is materialized.
      yield { name, data };
    }
    if (cursor !== central.length) {
      // A trailing digital-signature record is not emitted by Takeout. Failing
      // closed avoids treating an ambiguous directory as a complete import.
      throw new Error('invalid YouTube Takeout ZIP directory length');
    }
  } finally {
    await handle.close();
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function parseYoutubeTakeoutFile(
  path: string,
  options: { filename?: string; source_generation?: string } = {},
): Promise<ParsedYoutubeTakeout> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0) throw new Error('YouTube Takeout input is empty');
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error('YouTube Takeout input is too large');
  const handle = await open(path, 'r');
  let prefix: Buffer;
  try {
    prefix = await readExact(handle, Math.min(512, info.size), 0, 'YouTube Takeout input is empty');
  } finally {
    await handle.close();
  }
  const filename = basename(options.filename?.trim() || path);
  const format = takeoutInputFormat(prefix, filename);
  if (format !== 'zip' && info.size > MAX_FILE_BYTES) {
    throw new Error('YouTube Takeout file is too large');
  }
  const sourceGeneration = options.source_generation ?? await sha256File(path);
  const accumulator = takeoutAccumulator();
  if (format === 'zip') {
    let supportedFiles = 0;
    for await (const file of streamedZipTakeoutFiles(path)) {
      supportedFiles += 1;
      parseTakeoutFileInto(file, accumulator);
    }
    if (supportedFiles === 0) {
      throw new Error('YouTube Takeout contained no supported JSON or HTML files');
    }
  } else {
    parseTakeoutFileInto({
      name: safeArchiveName(filename || `takeout.${format}`),
      data: await readFile(path),
    }, accumulator);
  }
  return finishTakeoutParse(format, sourceGeneration, accumulator);
}

function takeoutItems(parsed: ParsedYoutubeTakeout, importedAt: number): YoutubeItem[] {
  return parsed.history.map((entry) => ({
    id: entry.video_id,
    kind: 'video',
    title: entry.title,
    subtitle: entry.channel_title || 'YouTube',
    description: null,
    thumbnail: null,
    channel_id: entry.channel_id,
    channel_title: entry.channel_title,
    published_at: null,
    duration_sec: null,
    live_status: 'none',
    playlist_id: null,
    updated_at: importedAt,
  }));
}

/**
 * Privacy-bounded import receipt. Parsed rows stay inside the importer and the
 * normalized databases; HTTP and CLI callers receive counts, never a viewer's
 * complete title/timestamp history or archive member names.
 */
export type YoutubeTakeoutImportResult = {
  format: YoutubeTakeoutFormat;
  files_read: number;
  parsed_history: number;
  ignored_subscriptions: number;
  imported_history: number;
  replaced_subscriptions: 0;
  noop: boolean;
  warnings: string[];
};

function recordTakeoutFailure(input: {
  source_hash: string;
  filename?: string;
  imported_at: number;
  error: unknown;
}): void {
  try {
    recordYoutubeV2TakeoutImport({
      generation: input.source_hash,
      format: 'unknown',
      source_filename: input.filename,
      source_hash: input.source_hash,
      status: 'failed',
      history_count: 0,
      subscription_count: 0,
      imported_at: input.imported_at,
      errors: [safeTakeoutAuditError(input.error)],
    });
  } catch {
    // The original bounded parse/stream error remains authoritative.
  }
}

function persistYoutubeTakeout(
  parsed: ParsedYoutubeTakeout,
  options: { filename?: string; imported_at: number },
): YoutubeTakeoutImportResult {
  const history = upsertYoutubeV2ImportedHistory(parsed.history, {
    source_generation: parsed.source_generation,
    imported_at: options.imported_at,
  });
  if (!history.noop) upsertYoutubeItems(takeoutItems(parsed, options.imported_at));
  const warnings = [
    ...parsed.warnings,
    ...(parsed.subscriptions.length > 0
      ? [`ignored ${parsed.subscriptions.length} non-authoritative Takeout subscriptions`]
      : []),
  ];
  recordYoutubeV2TakeoutImport({
    generation: parsed.source_generation,
    format: parsed.format,
    source_filename: options.filename,
    source_hash: parsed.source_generation,
    status: parsed.warnings.length > 0 || parsed.subscriptions.length > 0
      ? 'partial'
      : history.noop ? 'noop' : 'success',
    history_count: parsed.history.length,
    subscription_count: parsed.subscriptions.length,
    imported_at: options.imported_at,
    warnings,
    errors: [],
  });
  return {
    format: parsed.format,
    files_read: parsed.files_read.length,
    parsed_history: parsed.history.length,
    ignored_subscriptions: parsed.subscriptions.length,
    imported_history: history.inserted,
    replaced_subscriptions: 0,
    noop: history.noop,
    warnings,
  };
}

export function importYoutubeTakeout(
  input: Buffer | Uint8Array | string,
  options: { filename?: string; imported_at?: number } = {},
): YoutubeTakeoutImportResult {
  const importedAt = options.imported_at ?? Date.now();
  let parsed: ParsedYoutubeTakeout;
  try {
    parsed = parseYoutubeTakeout(input, options);
  } catch (error) {
    recordTakeoutFailure({
      source_hash: boundedTakeoutFailureHash(input),
      filename: options.filename,
      imported_at: importedAt,
      error,
    });
    throw error;
  }
  return persistYoutubeTakeout(parsed, { filename: options.filename, imported_at: importedAt });
}

export async function importYoutubeTakeoutFile(
  path: string,
  options: { filename?: string; imported_at?: number; source_generation?: string } = {},
): Promise<YoutubeTakeoutImportResult> {
  const importedAt = options.imported_at ?? Date.now();
  const filename = basename(options.filename?.trim() || path);
  let sourceHash = options.source_generation;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) throw new Error('YouTube Takeout input is empty');
    if (info.size > MAX_ARCHIVE_BYTES) throw new Error('YouTube Takeout input is too large');
    if (!sourceHash) sourceHash = await sha256File(path);
    const parsed = await parseYoutubeTakeoutFile(path, {
      filename,
      source_generation: sourceHash,
    });
    return persistYoutubeTakeout(parsed, { filename, imported_at: importedAt });
  } catch (error) {
    const failureHash = sourceHash ?? createHash('sha256')
      .update(`${filename}:${error instanceof Error ? error.message : String(error)}`)
      .digest('hex');
    recordTakeoutFailure({
      source_hash: failureHash,
      filename,
      imported_at: importedAt,
      error,
    });
    throw error;
  }
}

/**
 * Streams an uploaded archive to a private temporary file, parses ZIP members
 * one at a time, and removes the raw upload on every success/failure path.
 */
export async function importYoutubeTakeoutStream(
  input: AsyncIterable<Uint8Array | string>,
  options: { filename?: string; imported_at?: number; max_bytes?: number } = {},
): Promise<YoutubeTakeoutImportResult> {
  const importedAt = options.imported_at ?? Date.now();
  const filename = basename(options.filename?.trim() || 'youtube-takeout');
  const configuredLimit = Math.floor(options.max_bytes ?? MAX_ARCHIVE_BYTES);
  const maxBytes = Math.max(1, Math.min(MAX_ARCHIVE_BYTES, configuredLimit));
  const directory = await mkdtemp(join(tmpdir(), 'mango-youtube-takeout-'));
  const path = join(directory, 'upload.bin');
  const hash = createHash('sha256');
  let bytes = 0;
  let sourceHash: string | null = null;
  let parseOwnsFailureAudit = false;
  const limiter = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      bytes += data.length;
      if (bytes > maxBytes) {
        callback(new Error('YouTube Takeout input is too large'));
        return;
      }
      hash.update(data);
      callback(null, data);
    },
  });
  try {
    await pipeline(Readable.from(input), limiter, createWriteStream(path, {
      flags: 'wx',
      mode: 0o600,
    }));
    if (bytes === 0) throw new Error('YouTube Takeout input is empty');
    sourceHash = hash.digest('hex');
    parseOwnsFailureAudit = true;
    return await importYoutubeTakeoutFile(path, {
      filename,
      imported_at: importedAt,
      source_generation: sourceHash,
    });
  } catch (error) {
    if (!parseOwnsFailureAudit) {
      sourceHash ??= hash.digest('hex');
      recordTakeoutFailure({
        source_hash: sourceHash,
        filename,
        imported_at: importedAt,
        error,
      });
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

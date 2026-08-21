import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Stream } from './core.js';
import { isCacheableStream } from './stream-filters.js';

const MEDIAFUSION_SUPPLEMENT_BUDGET_MS = 8000;

export function countCacheableStreams(streams: Stream[]): number {
  return streams.filter(isCacheableStream).length;
}

/** True when AIO (or primary) left a thin pool and MediaFusion is not already a direct addon. */
export function shouldSupplementThinStreams(
  streams: Stream[],
  options: { hasDirectMediaFusion: boolean },
): boolean {
  if (options.hasDirectMediaFusion) return false;
  return countCacheableStreams(streams) <= 1;
}

/** Primary addon hard-timeout — do not burn another MF budget on an empty pool (3A). */
const HARD_TIMEOUT_RE = /timeout after \d+ms|\btimed?\s*out\b/i;

export function notesIndicatePrimaryHardTimeout(
  notes: Array<{ message?: string } | string>,
): boolean {
  for (const note of notes) {
    const message = typeof note === 'string' ? note : (note.message || '');
    if (HARD_TIMEOUT_RE.test(message)) {
      return true;
    }
  }
  return false;
}

/**
 * Skip MediaFusion thin-supplement when primary already hard-timed-out with
 * nothing cacheable — serial MF only adds dead couch wait.
 */
export function shouldSkipThinSupplementAfterPrimaryTimeout(
  streams: Stream[],
  notes: Array<{ message?: string } | string>,
): boolean {
  return countCacheableStreams(streams) === 0 && notesIndicatePrimaryHardTimeout(notes);
}

export function isMediaFusionAddon(name: string, manifestUrl: string): boolean {
  return /mediafusion/i.test(name) || /mediafusion/i.test(manifestUrl);
}

/**
 * Optional Pi-local MediaFusion share URL (secret). Env may be a URL or a file path.
 * File default: ~/.config/mango/mediafusion.manifest
 */
export async function loadMediaFusionManifestUrl(): Promise<string | null> {
  const fromEnv = process.env.MANGO_MEDIAFUSION_MANIFEST?.trim();
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) {
    return fromEnv;
  }
  const path = fromEnv && fromEnv.length > 0
    ? fromEnv
    : join(homedir(), '.config/mango/mediafusion.manifest');
  try {
    const text = (await readFile(path, 'utf8')).trim();
    if (/^https?:\/\//i.test(text)) return text;
  } catch {
    // optional — no MF share configured
  }
  return null;
}

export function mediaFusionStreamUrl(manifestUrl: string, type: string, id: string): string {
  const encodedType = encodeURIComponent(type);
  const encodedId = encodeURIComponent(id);
  const url = new URL(manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/stream/${encodedType}/${encodedId}.json`;
  url.hash = '';
  return url.toString();
}

export function mergeUniqueStreams(primary: Stream[], extra: Stream[]): Stream[] {
  const seen = new Set(
    primary.map((s) => (typeof s.url === 'string' ? s.url : '')).filter(Boolean),
  );
  const merged = [...primary];
  for (const stream of extra) {
    const url = typeof stream.url === 'string' ? stream.url : '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    merged.push(stream);
  }
  return merged;
}

export { MEDIAFUSION_SUPPLEMENT_BUDGET_MS };

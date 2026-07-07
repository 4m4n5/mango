import { buildLiveCatalogUrl, type LiveChannelMeta } from './live-rails.js';
import { isBlockedCatalogText } from './catalog-errors.js';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

export function isBlockedLiveStreamUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.startsWith('http')) {
    return true;
  }
  return /example\.com|ratelimit|rate\s*limit|too many/i.test(trimmed);
}

/**
 * Quick reachability probe for a live stream URL. Opens a GET, waits for the
 * first byte, then destroys the socket immediately. Returns true if the host
 * is reachable and starts delivering data within the timeout.
 *
 * This exists so /play fails fast (~5s) when a free IPTV-org host is
 * geo-blocked from the Pi instead of hanging for mpv's 90s playback-start
 * timeout. Safe for AREA69's max_connections=1 because the probe destroys its
 * socket before mpv opens its own connection.
 */
export function probeStreamReachability(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    if (isBlockedLiveStreamUrl(url)) {
      resolve(false);
      return;
    }
    const lib = url.startsWith('https:') ? httpsGet : httpGet;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        req.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    const req = lib(
      url,
      { headers: { 'User-Agent': 'mango-live-probe', Range: 'bytes=0-65535' } },
      (res) => {
        if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 400)) {
          res.destroy();
          finish(false);
          return;
        }
        res.once('data', () => {
          res.destroy();
          finish(true);
        });
        res.on('error', () => finish(false));
      },
    );
    req.on('error', () => finish(false));
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

export function isBlockedLiveChannel(channel: LiveChannelMeta): boolean {
  const haystack = [channel.id, channel.name, channel.title, channel.description]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return isBlockedCatalogText(haystack) || /ratelimit_error/i.test(haystack);
}

function buildLiveStreamUrl(manifestUrl: string, catalogType: string, channelId: string): string {
  const url = new URL(manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/stream/${encodeURIComponent(catalogType)}/${encodeURIComponent(channelId)}.json`;
  url.hash = '';
  return url.toString();
}

type JsonFetcher = (url: string, timeoutMs?: number) => Promise<unknown>;

export async function resolvePlayableLiveStreamUrl(
  manifestUrl: string,
  catalogType: string,
  channelId: string,
  fetchJson: JsonFetcher,
  timeoutMs = 20_000,
): Promise<string | null> {
  if (isBlockedLiveChannel({ id: channelId, name: channelId })) {
    return null;
  }
  let data: unknown;
  try {
    data = await fetchJson(buildLiveStreamUrl(manifestUrl, catalogType, channelId), timeoutMs);
  } catch {
    return null;
  }
  const streams = (data as { streams?: unknown[] }).streams;
  if (!Array.isArray(streams)) {
    return null;
  }
  for (const raw of streams) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const url = (raw as { url?: unknown }).url;
    if (typeof url === 'string' && !isBlockedLiveStreamUrl(url)) {
      return url;
    }
  }
  return null;
}

export type VerifiedLiveChannel = LiveChannelMeta & {
  source_addon: string;
  source_label?: string;
  stream_url?: string;
};

export async function verifyLiveChannelCandidates(
  manifestUrl: string,
  catalogType: string,
  sourceAddon: string,
  sourceLabel: string | undefined,
  candidates: LiveChannelMeta[],
  limit: number,
  fetchJson: JsonFetcher,
  options: { poolMultiplier?: number; delayMs?: number } = {},
): Promise<VerifiedLiveChannel[]> {
  const poolMultiplier = options.poolMultiplier ?? 2;
  const delayMs = options.delayMs ?? 120;
  const pool = candidates
    .filter((channel) => !isBlockedLiveChannel(channel))
    .slice(0, Math.max(limit * poolMultiplier, limit));
  const verified: VerifiedLiveChannel[] = [];

  for (const channel of pool) {
    if (verified.length >= limit) {
      break;
    }
    const streamUrl = await resolvePlayableLiveStreamUrl(
      manifestUrl,
      catalogType,
      channel.id,
      fetchJson,
    );
    if (!streamUrl) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      continue;
    }
    verified.push({
      ...channel,
      source_addon: sourceAddon,
      source_label: sourceLabel,
      stream_url: streamUrl,
    });
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return verified;
}

export function catalogPageUrl(
  manifestUrl: string,
  catalogType: string,
  catalogId: string,
  skip: number,
): string {
  return buildLiveCatalogUrl(manifestUrl, catalogType, catalogId, skip);
}

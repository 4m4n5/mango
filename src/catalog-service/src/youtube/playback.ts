import { execFile } from 'node:child_process';
import { CatalogError } from '../catalog-errors.js';
import type { YoutubeConfig } from './config.js';
import {
  YOUTUBE_FORMAT_SORT,
  ytDlpFormatCandidates,
} from './format-policy.js';

export {
  effectiveYoutubeFormat,
  isMuxedOnlyYoutubeFormat,
  preferAdaptiveYoutubeFormat,
  YOUTUBE_ADAPTIVE_FORMAT,
  YOUTUBE_COMPAT_ADAPTIVE_FORMAT,
  YOUTUBE_FORMAT_SORT,
  YOUTUBE_MID_ADAPTIVE_FORMAT,
  ytDlpFormatCandidates,
} from './format-policy.js';

export type YoutubeResolvedPlayback = {
  url: string;
  audio_url?: string;
  resolve_ms: number;
  format: string;
};

const youtubePlaybackInflight = new Map<string, Promise<YoutubeResolvedPlayback>>();
let youtubeResolveCooldownUntil = 0;
const YOUTUBE_RESOLVE_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function youtubeYtDlpResolveArgs(
  config: {
    yt_dlp_cookies?: string | null;
    yt_dlp_cookies_from_browser?: string | null;
  },
  format: string,
  videoId: string,
): string[] {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f',
    format,
    '--format-sort',
    process.env.MANGO_YTDLP_FORMAT_SORT?.trim() || YOUTUBE_FORMAT_SORT,
  ];
  // yt-dlp 2026.07 enables only deno by default. The Pi has node, not deno;
  // without an explicit runtime, web/web_safari formats are skipped and some
  // 4K DASH never appears. Do not pin player_client: tv/android/ios replaced
  // defaults and left only 360p muxed.
  const jsRuntimes = process.env.MANGO_YTDLP_JS_RUNTIMES?.trim();
  if (jsRuntimes !== 'none' && jsRuntimes !== '0') {
    args.push('--js-runtimes', jsRuntimes || 'node');
  }
  const extractorArgs = process.env.MANGO_YTDLP_EXTRACTOR_ARGS?.trim();
  if (extractorArgs) {
    args.push('--extractor-args', extractorArgs);
  }
  args.push('-g');
  if (config.yt_dlp_cookies) {
    args.push('--cookies', config.yt_dlp_cookies);
  }
  if (config.yt_dlp_cookies_from_browser) {
    args.push('--cookies-from-browser', config.yt_dlp_cookies_from_browser);
  }
  args.push(youtubeWatchUrl(videoId));
  return args;
}

function requestedFormatUnavailable(text: string): boolean {
  return /requested format is not available/i.test(text);
}

export function classifyYtDlpError(text: string): { status: number; message: string } {
  if (requestedFormatUnavailable(text)) {
    return {
      status: 502,
      message: 'YouTube playback format unavailable — try another YouTube video',
    };
  }
  if (/429|too many requests|captcha|not a bot|sign in to confirm/i.test(text)) {
    return {
      status: 429,
      message: 'YouTube is asking for browser verification — reconnect cookies/account and try again',
    };
  }
  if (/403|forbidden|private video|members-only|login required|sign in/i.test(text)) {
    return {
      status: 403,
      message: 'YouTube blocked this video for this account or device',
    };
  }
  if (/not available|unavailable|removed|copyright/i.test(text)) {
    return {
      status: 404,
      message: 'this YouTube video is unavailable',
    };
  }
  return {
    status: 502,
    message: 'YouTube playback could not be resolved',
  };
}

export function parseYtDlpResolvedUrls(output: string): { url: string; audio_url?: string } | null {
  const urls = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));
  if (urls.length === 0) {
    return null;
  }
  return {
    url: urls[0],
    audio_url: urls[1],
  };
}

export async function resolveYoutubePlayback(
  config: YoutubeConfig,
  videoId: string,
  timeoutMs = 30000,
  options: { excludeFormats?: string[] } = {},
): Promise<YoutubeResolvedPlayback> {
  const normalizedVideoId = videoId.trim();
  if (!normalizedVideoId) {
    throw new CatalogError(400, 'YouTube video id is required', undefined, {
      couchMessage: 'YouTube video id is missing',
    });
  }
  if (youtubeResolveCooldownUntil > Date.now()) {
    throw new CatalogError(429, 'YouTube playback resolve is cooling down', undefined, {
      couchMessage: 'YouTube is temporarily busy — try again in a few minutes',
    });
  }
  const excludedFormats = options.excludeFormats ?? [];
  const flightKey = `${normalizedVideoId}\0${[...excludedFormats].sort().join('\0')}`;
  const inflight = youtubePlaybackInflight.get(flightKey);
  if (inflight) {
    return inflight;
  }
  const resolvePromise = resolveYoutubePlaybackFresh(
    config,
    normalizedVideoId,
    timeoutMs,
    excludedFormats,
  )
    .finally(() => {
      youtubePlaybackInflight.delete(flightKey);
    });
  youtubePlaybackInflight.set(flightKey, resolvePromise);
  return resolvePromise;
}

async function resolveYoutubePlaybackFresh(
  config: YoutubeConfig,
  normalizedVideoId: string,
  timeoutMs = 30000,
  excludedFormats: string[] = [],
): Promise<YoutubeResolvedPlayback> {
  const started = Date.now();
  let lastFormatError = '';
  for (const format of ytDlpFormatCandidates(config.yt_dlp_format, excludedFormats)) {
    const args = youtubeYtDlpResolveArgs(config, format, normalizedVideoId);
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(config.yt_dlp_command, args, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${stderr || stdout || error.message}`.trim()));
          return;
        }
        resolve({ stdout, stderr });
      });
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (requestedFormatUnavailable(detail)) {
        lastFormatError = detail;
        return null;
      }
      const classified = classifyYtDlpError(detail);
      if (classified.status === 429) {
        youtubeResolveCooldownUntil = Date.now() + YOUTUBE_RESOLVE_RATE_LIMIT_COOLDOWN_MS;
      }
      throw new CatalogError(classified.status, classified.message, { yt_dlp: detail }, {
        couchMessage: classified.message,
      });
    });
    if (!result) {
      continue;
    }
    const { stdout, stderr } = result;
    const resolved = parseYtDlpResolvedUrls(stdout);
    if (resolved) {
      const payload = {
        ...resolved,
        resolve_ms: Date.now() - started,
        format,
      };
      return payload;
    }
    const detail = stderr || stdout;
    if (requestedFormatUnavailable(detail)) {
      lastFormatError = detail;
      continue;
    }
    const classified = classifyYtDlpError(detail);
    throw new CatalogError(classified.status, classified.message, { yt_dlp: detail }, {
      couchMessage: classified.message,
    });
  }
  const classified = classifyYtDlpError(lastFormatError || 'yt-dlp returned no playable URLs');
  throw new CatalogError(classified.status, classified.message, { yt_dlp: lastFormatError }, {
    couchMessage: classified.message,
  });
}

export function shouldRefreshYoutubeTransport(message: string): boolean {
  return /HTTP (?:error )?(?:401|403|404|410)\b|expired|signature|signed[\s_-]*url|ECONN|socket|fetch failed|did not start playback|partial file|cannot seek|invalid data/i
    .test(message);
}

export function resetYoutubePlaybackStateForTest(): void {
  youtubePlaybackInflight.clear();
  youtubeResolveCooldownUntil = 0;
}

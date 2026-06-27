import { execFile } from 'node:child_process';
import { CatalogError } from '../catalog-errors.js';
import type { YoutubeConfig } from './config.js';

export type YoutubeResolvedPlayback = {
  url: string;
  audio_url?: string;
  resolve_ms: number;
  format: string;
};

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function ytDlpFormatCandidates(configured: string): string[] {
  return [
    configured,
    'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    'bv*[height<=1080]+ba/b[height<=1080]/b',
    'best*[height<=1080]/best*',
    'best[height<=1080]/best',
    'best',
  ]
    .map((format) => format.trim())
    .filter(Boolean)
    .filter((format, index, formats) => formats.indexOf(format) === index);
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
): Promise<YoutubeResolvedPlayback> {
  if (!videoId.trim()) {
    throw new CatalogError(400, 'YouTube video id is required', undefined, {
      couchMessage: 'YouTube video id is missing',
    });
  }
  const started = Date.now();
  let lastFormatError = '';
  for (const format of ytDlpFormatCandidates(config.yt_dlp_format)) {
    const args = [
      '--no-playlist',
      '--no-warnings',
      '-f',
      format,
      '-g',
    ];
    if (config.yt_dlp_cookies) {
      args.push('--cookies', config.yt_dlp_cookies);
    }
    if (config.yt_dlp_cookies_from_browser) {
      args.push('--cookies-from-browser', config.yt_dlp_cookies_from_browser);
    }
    args.push(youtubeWatchUrl(videoId));
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
      return {
        ...resolved,
        resolve_ms: Date.now() - started,
        format,
      };
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

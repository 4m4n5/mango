import { execFile } from 'node:child_process';
import { CatalogError } from '../catalog-errors.js';
import type { YoutubeConfig } from './config.js';

export type YoutubeResolvedPlayback = {
  url: string;
  audio_url?: string;
  resolve_ms: number;
};

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function classifyYtDlpError(text: string): { status: number; message: string } {
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
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f',
    config.yt_dlp_format,
    '-g',
  ];
  if (config.yt_dlp_cookies) {
    args.push('--cookies', config.yt_dlp_cookies);
  }
  if (config.yt_dlp_cookies_from_browser) {
    args.push('--cookies-from-browser', config.yt_dlp_cookies_from_browser);
  }
  args.push(youtubeWatchUrl(videoId));
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(config.yt_dlp_command, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${stderr || stdout || error.message}`.trim();
        const classified = classifyYtDlpError(detail);
        reject(new CatalogError(classified.status, classified.message, { yt_dlp: detail }, {
          couchMessage: classified.message,
        }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
  const resolved = parseYtDlpResolvedUrls(stdout);
  if (!resolved) {
    const classified = classifyYtDlpError(stderr || stdout);
    throw new CatalogError(classified.status, classified.message, { yt_dlp: stderr || stdout }, {
      couchMessage: classified.message,
    });
  }
  return {
    ...resolved,
    resolve_ms: Date.now() - started,
  };
}

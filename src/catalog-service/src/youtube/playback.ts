import { execFile, spawnSync, type ExecFileException } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { CatalogError } from '../catalog-errors.js';
import { classifyPlayError } from '../play-error-classify.js';
import { PlayCancelledError } from '../play-cancel.js';
import type { YoutubeConfig } from './config.js';
import {
  YOUTUBE_FORMAT_SORT,
  ytDlpFormatCandidates,
} from './format-policy.js';

export {
  effectiveYoutubeFormat,
  isHlsYoutubeFormat,
  isMuxedOnlyYoutubeFormat,
  preferAdaptiveYoutubeFormat,
  YOUTUBE_ADAPTIVE_FORMAT,
  YOUTUBE_COMPAT_ADAPTIVE_FORMAT,
  YOUTUBE_FORMAT_SORT,
  YOUTUBE_MID_ADAPTIVE_FORMAT,
  ytDlpFormatCandidates,
} from './format-policy.js';

/**
 * web_safari still requested for HLS when YouTube offers hlsManifestUrl.
 * After mid-2026 many titles have no safari m3u8. mweb https DASH then
 * returns googlevideo URLs (`c=MWEB`, n+pot) that 403 for curl and mpv on
 * this household path. tv_simply (`c=TVHTML5_SIMPLY`) is the living DASH
 * client: same adaptive itags, household cookies, and mpv split A/V succeed.
 * Do not put mweb after tv_simply as a "fallback" — those URLs are not
 * playable here. Do not pin tv/android/ios alone: that historically left
 * only muxed 360p, and `tv`/`tv_downgraded` still error with cookies.
 */
export const YOUTUBE_PLAYER_CLIENT = 'web_safari,tv_simply';

export type YoutubeResolvedPlayback = {
  url: string;
  audio_url?: string;
  resolve_ms: number;
  format: string;
};

/** Bounded, identifier-free kind for terminal telemetry. */
export const YOUTUBE_FAILURE_KINDS = [
  'timeout',
  'bot_check',
  'cooldown',
  'blocked',
  'format_unavailable',
  'unavailable',
  'js_runtime',
  'mpv_handoff',
  'other',
] as const;
export type YoutubeFailureKind = (typeof YOUTUBE_FAILURE_KINDS)[number];
export type YoutubePlaybackStage = 'resolve' | 'play_start';

export const YOUTUBE_SOCKET_TIMEOUT_SEC = 10;

const youtubePlaybackInflight = new Map<string, Promise<YoutubeResolvedPlayback>>();
let youtubeResolveCooldownUntil = 0;
const YOUTUBE_RESOLVE_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const TRANSIENT_YOUTUBE_RESOLVE_RE =
  /timeout|timed out|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|socket|fetch failed|network is unreachable|temporary failure in name resolution|did not get any data/i;

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
    '--socket-timeout',
    String(youtubeSocketTimeoutSec()),
    '-f',
    format,
    '--format-sort',
    process.env.MANGO_YTDLP_FORMAT_SORT?.trim() || YOUTUBE_FORMAT_SORT,
  ];
  // yt-dlp 2026.07 solves YouTube n-sig only with Deno >=2.3 (or Node >=22)
  // plus the EJS solver. Prefer web_safari HLS when present; tv_simply https
  // DASH is the living transport after safari m3u8 disappeared and mweb GVS
  // URLs started 403ing for both curl and mpv. Debian Node 20 is ignored.
  args.push(...youtubeJsRuntimeArgs());
  args.push(...youtubeRemoteComponentArgs());
  args.push(...youtubeExtractorArgFlags());
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

export function mangoBgutilServerHome(): string {
  return process.env.MANGO_BGUTIL_POT?.trim()
    || `${homedir()}/.local/share/mango/bgutil-pot/server`;
}

export function youtubeRemoteComponentArgs(): string[] {
  const raw = process.env.MANGO_YTDLP_REMOTE_COMPONENTS?.trim();
  if (raw === 'none' || raw === '0') {
    return [];
  }
  return ['--remote-components', raw || 'ejs:github'];
}

/** Separate --extractor-args flags; yt-dlp does not split namespaces on ';' here. */
export function youtubeExtractorArgFlags(): string[] {
  const args: string[] = [];
  const potHome = mangoBgutilServerHome();
  if (existsSync(potHome)) {
    args.push('--extractor-args', `youtubepot-bgutilscript:server_home=${potHome}`);
  }
  const operator = process.env.MANGO_YTDLP_EXTRACTOR_ARGS?.trim();
  if (operator) {
    args.push('--extractor-args', operator);
  } else {
    args.push('--extractor-args', `youtube:player_client=${YOUTUBE_PLAYER_CLIENT}`);
  }
  return args;
}

export function mangoDenoPath(): string {
  return process.env.MANGO_DENO?.trim()
    || `${homedir()}/.local/share/mango/deno/bin/deno`;
}

function denoOnPath(): boolean {
  const result = spawnSync('deno', ['--version'], {
    encoding: 'utf8',
    timeout: 4000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

/** yt-dlp 2026.07+ can solve YouTube n-sig only with Deno >=2.3 or Node >=22. */
export function youtubeJsRuntimeAvailable(): boolean {
  const raw = process.env.MANGO_YTDLP_JS_RUNTIMES?.trim();
  if (raw === 'none' || raw === '0') {
    return true;
  }
  return existsSync(mangoDenoPath()) || denoOnPath();
}

function throwMissingYoutubeJsRuntime(): never {
  throw new CatalogError(
    503,
    'YouTube playback is missing a JavaScript runtime',
    youtubeFailureDetails('js_runtime', 'resolve'),
    {
      couchMessage: 'YouTube playback is unavailable right now — try another video',
    },
  );
}

/** yt-dlp --js-runtimes values. Empty when the operator disables JS challenges. */
export function youtubeJsRuntimeArgs(): string[] {
  const raw = process.env.MANGO_YTDLP_JS_RUNTIMES?.trim();
  if (raw === 'none' || raw === '0') {
    return [];
  }
  if (raw) {
    return ['--js-runtimes', raw];
  }
  const deno = mangoDenoPath();
  if (existsSync(deno)) {
    return ['--js-runtimes', `deno:${deno}`, '--js-runtimes', 'node'];
  }
  return ['--js-runtimes', 'deno', '--js-runtimes', 'node'];
}

export function youtubeSocketTimeoutSec(): number {
  const raw = process.env.MANGO_YTDLP_SOCKET_TIMEOUT?.trim();
  if (!raw) return YOUTUBE_SOCKET_TIMEOUT_SEC;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) {
    return YOUTUBE_SOCKET_TIMEOUT_SEC;
  }
  return Math.round(parsed);
}

function isYoutubeBotCheck(text: string): boolean {
  return classifyPlayError(text) === 'rate_limited'
    || /captcha|not a bot|confirm you(?:'| a)?re not a bot/i.test(text);
}

function isYoutubeBlocked(text: string): boolean {
  return /HTTP (?:error )?403\b|\bforbidden\b|private video|members-only|login required|\bsign in\b/i
    .test(text);
}

export function classifyYtDlpError(text: string): {
  status: number;
  message: string;
  kind: YoutubeFailureKind;
} {
  if (
    /n challenge solving failed|Remote components challenge solver script/i.test(text)
    || /No supported JavaScript runtime|JS Challenge Providers:.*all unavailable/i.test(text)
  ) {
    return {
      status: 503,
      kind: 'js_runtime',
      message: 'YouTube playback is missing a JavaScript runtime',
    };
  }
  if (requestedFormatUnavailable(text)) {
    return {
      status: 502,
      kind: 'format_unavailable',
      message: 'YouTube playback format unavailable — try another YouTube video',
    };
  }
  if (TRANSIENT_YOUTUBE_RESOLVE_RE.test(text)) {
    return {
      status: 502,
      kind: 'timeout',
      message: 'YouTube playback could not be resolved',
    };
  }
  if (isYoutubeBotCheck(text)) {
    return {
      status: 429,
      kind: 'bot_check',
      message: 'YouTube is asking for browser verification — reconnect cookies/account and try again',
    };
  }
  if (isYoutubeBlocked(text)) {
    return {
      status: 403,
      kind: 'blocked',
      message: 'YouTube blocked this video for this account or device',
    };
  }
  if (/not available|unavailable|removed|copyright/i.test(text)) {
    return {
      status: 404,
      kind: 'unavailable',
      message: 'this YouTube video is unavailable',
    };
  }
  return {
    status: 502,
    kind: 'other',
    message: 'YouTube playback could not be resolved',
  };
}

export function youtubeFailureDetails(
  kind: YoutubeFailureKind,
  stage: YoutubePlaybackStage,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...extra,
    playback_stage: stage,
    failure_kind: kind,
  };
}

export function youtubeMpvFailureKind(message: string): YoutubeFailureKind {
  if (/\bmpv vo not ready\b|\bmpv handoff failed\b/i.test(message)) return 'mpv_handoff';
  if (/HTTP (?:error )?403\b|\bforbidden\b/i.test(message)) return 'blocked';
  if (TRANSIENT_YOUTUBE_RESOLVE_RE.test(message) || /did not start playback/i.test(message)) {
    return 'timeout';
  }
  return 'other';
}

export function isTransientYoutubeResolveError(error: unknown): boolean {
  if (error instanceof CatalogError) {
    if (error.status === 429 || error.status === 403 || error.status === 404 || error.status < 500) {
      return false;
    }
    const kind = error.details?.failure_kind;
    if (kind === 'timeout') return true;
    if (
      kind === 'format_unavailable'
      || kind === 'blocked'
      || kind === 'bot_check'
      || kind === 'cooldown'
      || kind === 'unavailable'
      || kind === 'js_runtime'
    ) {
      return false;
    }
    const detail = typeof error.details?.yt_dlp === 'string' ? error.details.yt_dlp : error.message;
    return TRANSIENT_YOUTUBE_RESOLVE_RE.test(detail);
  }
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_YOUTUBE_RESOLVE_RE.test(message);
}

function ytDlpExecErrorMessage(error: ExecFileException, stdout: string, stderr: string): string {
  const detail = `${stderr || stdout || error.message}`.trim();
  if (error.killed || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT') {
    return `yt-dlp timed out: ${detail}`;
  }
  return detail;
}

function sanitizeYtDlpDetail(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, '<url>').slice(0, 800);
}

function throwYtDlpCatalogError(detail: string, extra: Record<string, unknown> = {}): never {
  const classified = classifyYtDlpError(detail);
  if (classified.status === 429) {
    youtubeResolveCooldownUntil = Date.now() + YOUTUBE_RESOLVE_RATE_LIMIT_COOLDOWN_MS;
  }
  throw new CatalogError(
    classified.status,
    classified.message,
    youtubeFailureDetails(classified.kind, 'resolve', {
      yt_dlp: sanitizeYtDlpDetail(detail),
      ...extra,
    }),
    { couchMessage: classified.message },
  );
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
    throw new CatalogError(429, 'YouTube playback resolve is cooling down', youtubeFailureDetails('cooldown', 'resolve', {
      resolve_ms: 0,
    }), {
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
  if (!youtubeJsRuntimeAvailable()) {
    throwMissingYoutubeJsRuntime();
  }
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
          reject(new Error(ytDlpExecErrorMessage(error, stdout, stderr)));
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
      throwYtDlpCatalogError(detail, { resolve_ms: Date.now() - started });
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
    if (
      /No supported JavaScript runtime|JS Challenge Providers:.*all unavailable/i.test(stderr)
      || /n challenge solving failed|Remote components challenge solver script/i.test(stderr)
    ) {
      throwMissingYoutubeJsRuntime();
    }
    const detail = stderr || stdout;
    if (requestedFormatUnavailable(detail)) {
      lastFormatError = detail;
      continue;
    }
    throwYtDlpCatalogError(detail, { resolve_ms: Date.now() - started });
  }
  const classified = classifyYtDlpError(lastFormatError || 'yt-dlp returned no playable URLs');
  throw new CatalogError(
    classified.status,
    classified.message,
    youtubeFailureDetails(classified.kind, 'resolve', {
      yt_dlp: sanitizeYtDlpDetail(lastFormatError || 'yt-dlp returned no playable URLs'),
      resolve_ms: Date.now() - started,
    }),
    { couchMessage: classified.message },
  );
}

export function shouldRefreshYoutubeTransport(message: string): boolean {
  return /HTTP (?:error )?(?:401|403|404|410)\b|expired|signature|signed[\s_-]*url|ECONN|socket|fetch failed|did not start playback|partial file|cannot seek|invalid data/i
    .test(message);
}

/** Disposition after mpv-play fails on an already resolved YouTube URL. */
export function youtubePlayStartDisposition(error: unknown): 'cancel' | 'refresh' | 'fail' {
  if (error instanceof PlayCancelledError) {
    return 'cancel';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (shouldRefreshYoutubeTransport(message)) {
    return 'refresh';
  }
  return 'fail';
}

export function resetYoutubePlaybackStateForTest(): void {
  youtubePlaybackInflight.clear();
  youtubeResolveCooldownUntil = 0;
}

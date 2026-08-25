import { execFile, spawnSync, type ExecFileException } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CatalogError } from '../catalog-errors.js';
import { classifyPlayError } from '../play-error-classify.js';
import { PlayCancelledError } from '../play-cancel.js';
import type { YoutubeConfig } from './config.js';
import {
  YOUTUBE_FORMAT_SORT,
  ytDlpFormatCandidates,
} from './format-policy.js';
import { youtubePotBaseUrl } from './runtime.js';

export {
  effectiveYoutubeFormat,
  isHlsYoutubeFormat,
  isMuxedOnlyYoutubeFormat,
  preferAdaptiveYoutubeFormat,
  YOUTUBE_ADAPTIVE_FORMAT,
  YOUTUBE_COMPAT_ADAPTIVE_FORMAT,
  YOUTUBE_FORMAT_SORT,
  YOUTUBE_MAX_HEIGHT,
  YOUTUBE_MID_ADAPTIVE_FORMAT,
  ytDlpFormatCandidates,
} from './format-policy.js';

/**
 * Player-client maintenance belongs to yt-dlp. YouTube changes client
 * capabilities independently of Mango, so a Mango-owned client list turns a
 * point-in-time workaround into a future outage. Operators may still set
 * MANGO_YTDLP_EXTRACTOR_ARGS as a temporary, observable escape hatch.
 */
export const YOUTUBE_PLAYER_CLIENT_POLICY = 'upstream_default' as const;

export type YoutubeResolverSlot = 'active' | 'previous';
export type YoutubeResolverAuth = 'anonymous' | 'cookies';

export type YoutubeResolvedPlayback = {
  url: string;
  audio_url?: string;
  resolve_ms: number;
  format: string;
  live: boolean;
  live_status: string;
  duration_sec: number | null;
  height: number | null;
  fps: number | null;
  resolver_slot: YoutubeResolverSlot;
  resolver_auth: YoutubeResolverAuth;
};

export type YoutubeCommandRunner = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

let youtubeCommandRunnerForTest: YoutubeCommandRunner | null = null;

export function setYoutubeCommandRunnerForTest(runner: YoutubeCommandRunner | null): void {
  youtubeCommandRunnerForTest = runner;
}

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
let youtubeRuntimeRefreshRequestedAt = 0;
const YOUTUBE_RESOLVE_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const YOUTUBE_RUNTIME_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;
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
  options: { includeCookies?: boolean } = {},
): string[] {
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--socket-timeout',
    String(youtubeSocketTimeoutSec()),
    '-f',
    format,
    '--format-sort',
    process.env.MANGO_YTDLP_FORMAT_SORT?.trim() || YOUTUBE_FORMAT_SORT,
  ];
  // yt-dlp solves YouTube n-sig with a supported JS runtime plus EJS. Do not
  // pin player_client here: upstream changed its maintained defaults several
  // times in 2026 alone. Resolve public videos anonymously first so account
  // cookies cannot opt the household into stricter client/SABR experiments.
  args.push(...youtubeJsRuntimeArgs());
  args.push(...youtubeRemoteComponentArgs());
  args.push(...youtubeExtractorArgFlags());
  args.push(
    '--print',
    'MANGO_META:%(live_status)s|%(duration)s|%(protocol)s|%(height)s|%(fps)s',
  );
  args.push('-g');
  if (options.includeCookies && config.yt_dlp_cookies) {
    args.push('--cookies', config.yt_dlp_cookies);
  }
  if (options.includeCookies && config.yt_dlp_cookies_from_browser) {
    args.push('--cookies-from-browser', config.yt_dlp_cookies_from_browser);
  }
  args.push(youtubeWatchUrl(videoId));
  return args;
}

function requestedFormatUnavailable(text: string): boolean {
  return /requested format is not available/i.test(text);
}

export function youtubeRemoteComponentArgs(): string[] {
  const raw = process.env.MANGO_YTDLP_REMOTE_COMPONENTS?.trim();
  if (!raw || raw === 'none' || raw === '0') {
    return [];
  }
  return ['--remote-components', raw];
}

/** Keep the default loopback POT provider explicit; append operator overrides only. */
export function youtubeExtractorArgFlags(): string[] {
  const flags = process.env.MANGO_YOUTUBE_POT?.trim() === '0'
    ? []
    : [
        '--extractor-args',
        `youtubepot-bgutilhttp:base_url=${youtubePotBaseUrl()}`,
      ];
  const operator = process.env.MANGO_YTDLP_EXTRACTOR_ARGS?.trim();
  return operator ? [...flags, '--extractor-args', operator] : flags;
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

function youtubePublicFailureCategory(
  kind: YoutubeFailureKind,
  stage: YoutubePlaybackStage,
): 'player_failure' | 'resolve_failure' | 'unavailable' | 'blocked' {
  if (stage === 'play_start') return 'player_failure';
  if (kind === 'unavailable' || kind === 'format_unavailable') return 'unavailable';
  if (kind === 'blocked' || kind === 'bot_check' || kind === 'cooldown') return 'blocked';
  return 'resolve_failure';
}

/** HTTP-safe YouTube failure evidence: kinds and counts, never URLs or stderr. */
export function publicYoutubePlayFailureDetails(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const record = details as Record<string, unknown>;
  const kind = YOUTUBE_FAILURE_KINDS.includes(record.failure_kind as YoutubeFailureKind)
    ? record.failure_kind as YoutubeFailureKind
    : 'other';
  const stage: YoutubePlaybackStage = record.playback_stage === 'play_start' ? 'play_start' : 'resolve';
  const category = typeof record.category === 'string' && record.category.trim()
    ? record.category.trim().slice(0, 64)
    : youtubePublicFailureCategory(kind, stage);
  const out: Record<string, unknown> = {
    failure_kind: kind,
    playback_stage: stage,
    category,
    attempt_count: typeof record.attempt_count === 'number' && Number.isFinite(record.attempt_count)
      ? record.attempt_count
      : 1,
  };
  if (typeof record.resolve_ms === 'number' && Number.isFinite(record.resolve_ms)) {
    out.resolve_ms = record.resolve_ms;
  }
  return out;
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
  if (error instanceof PlayCancelledError) return false;
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

export function isYoutubeLiveStatus(value: string | null | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'live' || normalized === 'is_live';
}

export function parseYoutubeResolveMeta(output: string): {
  live: boolean;
  live_status: string;
  duration_sec: number | null;
  height: number | null;
  fps: number | null;
} {
  const match = output.match(
    /^MANGO_META:([^\s|]+)\|([^|\s]*)\|([^|\s]+)(?:\|([^|\s]*)(?:\|([^|\s]*))?)?/im,
  );
  const liveStatus = match?.[1]?.trim() || 'none';
  const durationRaw = match?.[2]?.trim() || '';
  const duration = Number(durationRaw);
  const height = Number(match?.[4]?.trim() || '');
  const fps = Number(match?.[5]?.trim() || '');
  return {
    live: isYoutubeLiveStatus(liveStatus),
    live_status: liveStatus,
    duration_sec: Number.isFinite(duration) && duration > 0 ? duration : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    fps: Number.isFinite(fps) && fps > 0 ? fps : null,
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

async function runYoutubeYtDlp(
  command: string,
  args: string[],
  timeoutMs: number,
  slot: YoutubeResolverSlot,
): Promise<{ stdout: string; stderr: string }> {
  const options = {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      MANGO_YTDLP_SLOT: slot,
    },
  };
  if (youtubeCommandRunnerForTest) {
    return youtubeCommandRunnerForTest(command, args, options);
  }
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(ytDlpExecErrorMessage(error, stdout, stderr)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function youtubeResolverSlotRoot(): string {
  return process.env.MANGO_YTDLP_SLOT_ROOT?.trim()
    || join(process.env.HOME || homedir(), '.local/share/mango/ytdlp-slots');
}

function previousYoutubeResolverAvailable(command: string): boolean {
  if (basename(command) !== 'youtube-yt-dlp.sh') return false;
  const previous = join(youtubeResolverSlotRoot(), 'previous');
  if (!existsSync(join(previous, 'venv/bin/yt-dlp'))) return false;
  try {
    const meta = JSON.parse(readFileSync(join(previous, 'meta.json'), 'utf8')) as {
      revision?: unknown;
      channel?: unknown;
      ejs?: unknown;
      js_runtime?: unknown;
      canary?: unknown;
      canary_result?: unknown;
    };
    const result = meta.canary_result as Record<string, unknown> | null;
    const total = Number(result?.total);
    const passed = Number(result?.passed);
    const requiredTotal = Number(result?.required_total);
    const requiredPassed = Number(result?.required_passed);
    const dynamicTotal = Number(result?.dynamic_total);
    const dynamicPassed = Number(result?.dynamic_passed);
    const expectedChannel = process.env.MANGO_YTDLP_CHANNEL?.trim() || 'nightly';
    return typeof meta.revision === 'string'
      && meta.revision.trim().length > 0
      && meta.channel === expectedChannel
      && meta.ejs === true
      && (meta.js_runtime === 'deno' || meta.js_runtime === 'node')
      && meta.canary === 'pass'
      && result?.ok === true
      && result?.transport === true
      && Number.isFinite(total)
      && Number.isFinite(passed)
      && total >= requiredTotal
      && passed >= requiredPassed
      && passed <= total
      && Number.isFinite(requiredTotal)
      && requiredTotal >= 3
      && requiredPassed === requiredTotal
      && dynamicTotal >= 0
      && dynamicTotal <= requiredTotal
      && dynamicPassed === dynamicTotal;
  } catch {
    return false;
  }
}

function ytDlpErrorDetail(error: unknown): string {
  if (error instanceof CatalogError && typeof error.details?.yt_dlp === 'string') {
    return error.details.yt_dlp;
  }
  return error instanceof Error ? error.message : String(error);
}

function shouldRetryYoutubeWithCookies(error: unknown): boolean {
  if (!(error instanceof CatalogError)) {
    return false;
  }
  const kind = error.details?.failure_kind;
  if (kind !== 'blocked' && kind !== 'bot_check') return false;
  return /confirm (?:your )?age|age[- ]restricted|members[- ]only|private video|login required/i
    .test(ytDlpErrorDetail(error))
    || (
      kind === 'bot_check'
      && /sign in to confirm (?:you(?:'|’)re|you are) not a bot/i.test(ytDlpErrorDetail(error))
    );
}

function shouldTryPreviousYoutubeResolver(error: unknown): boolean {
  if (!(error instanceof CatalogError)) return true;
  return ['format_unavailable', 'js_runtime', 'other'].includes(
    String(error.details?.failure_kind || ''),
  );
}

function requestYoutubeRuntimeRefresh(error: unknown): void {
  if (youtubeCommandRunnerForTest) return;
  const now = Date.now();
  if (now - youtubeRuntimeRefreshRequestedAt < YOUTUBE_RUNTIME_REFRESH_COOLDOWN_MS) return;
  const kind = error instanceof CatalogError
    ? String(error.details?.failure_kind || 'other')
    : 'other';
  const request = process.env.MANGO_YTDLP_REFRESH_REQUEST?.trim()
    || join(process.env.HOME || homedir(), '.cache/mango/youtube-runtime-refresh.request');
  const temporary = `${request}.tmp.${process.pid}`;
  try {
    mkdirSync(dirname(request), { recursive: true });
    writeFileSync(
      temporary,
      `failure_kind=${YOUTUBE_FAILURE_KINDS.includes(kind as YoutubeFailureKind) ? kind : 'other'}\n`
        + `requested_at=${now}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    renameSync(temporary, request);
    youtubeRuntimeRefreshRequestedAt = now;
  } catch {
    // Repair signalling must never replace the classified couch-safe failure.
  }
}

function youtubeCookiesConfigured(config: YoutubeConfig): boolean {
  return Boolean(config.yt_dlp_cookies || config.yt_dlp_cookies_from_browser);
}

async function resolveYoutubePlaybackAttempt(
  config: YoutubeConfig,
  normalizedVideoId: string,
  deadlineAt: number,
  excludedFormats: string[],
  started: number,
  slot: YoutubeResolverSlot,
  auth: YoutubeResolverAuth,
): Promise<YoutubeResolvedPlayback> {
  let lastFormatError = '';
  for (const format of ytDlpFormatCandidates(config.yt_dlp_format, excludedFormats)) {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      throwYtDlpCatalogError('yt-dlp timed out: resolver deadline exhausted', {
        resolve_ms: Date.now() - started,
      });
    }
    const args = youtubeYtDlpResolveArgs(config, format, normalizedVideoId, {
      includeCookies: auth === 'cookies',
    });
    const result = await runYoutubeYtDlp(
      config.yt_dlp_command,
      args,
      remainingMs,
      slot,
    ).catch((error: unknown) => {
      if (error instanceof PlayCancelledError) throw error;
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
      const meta = parseYoutubeResolveMeta(stdout);
      return {
        ...resolved,
        ...meta,
        resolve_ms: Date.now() - started,
        format,
        resolver_slot: slot,
        resolver_auth: auth,
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

async function resolveYoutubePlaybackFresh(
  config: YoutubeConfig,
  normalizedVideoId: string,
  timeoutMs = 30000,
  excludedFormats: string[] = [],
): Promise<YoutubeResolvedPlayback> {
  if (!youtubeCommandRunnerForTest && !youtubeJsRuntimeAvailable()) {
    requestYoutubeRuntimeRefresh(new CatalogError(
      503,
      'YouTube playback is missing a JavaScript runtime',
      youtubeFailureDetails('js_runtime', 'resolve'),
    ));
    throwMissingYoutubeJsRuntime();
  }
  const started = Date.now();
  const deadlineAt = started + Math.max(1, timeoutMs);
  const slots: YoutubeResolverSlot[] = previousYoutubeResolverAvailable(config.yt_dlp_command)
    ? ['active', 'previous']
    : ['active'];
  let activeError: unknown = null;

  for (const slot of slots) {
    try {
      return await resolveYoutubePlaybackAttempt(
        config,
        normalizedVideoId,
        deadlineAt,
        excludedFormats,
        started,
        slot,
        'anonymous',
      );
    } catch (anonymousError) {
      let finalError = anonymousError;
      if (youtubeCookiesConfigured(config) && shouldRetryYoutubeWithCookies(anonymousError)) {
        try {
          return await resolveYoutubePlaybackAttempt(
            config,
            normalizedVideoId,
            deadlineAt,
            excludedFormats,
            started,
            slot,
            'cookies',
          );
        } catch (cookieError) {
          finalError = cookieError;
        }
      }
      if (slot === 'active' && shouldTryPreviousYoutubeResolver(finalError)) {
        requestYoutubeRuntimeRefresh(finalError);
        if (slots.length > 1) {
          activeError = finalError;
          continue;
        }
      }
      throw finalError;
    }
  }
  throw activeError instanceof Error
    ? activeError
    : new Error('YouTube resolver slots returned no result');
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
  youtubeRuntimeRefreshRequestedAt = 0;
  youtubeCommandRunnerForTest = null;
}

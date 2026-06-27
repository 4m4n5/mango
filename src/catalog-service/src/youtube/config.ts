import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export type YoutubeConfig = {
  enabled: boolean;
  db_path: string;
  api_key: string | null;
  api_key_file: string;
  oauth_client_file: string;
  auth_token_file: string;
  region_code: string;
  relevance_language: string;
  max_results: number;
  exclude_shorts: boolean;
  stale_after_ms: number;
  yt_dlp_command: string;
  yt_dlp_format: string;
  yt_dlp_cookies: string | null;
  yt_dlp_cookies_from_browser: string | null;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, '../../../..');

function readYamlConfig(): Record<string, unknown> {
  const configPath = process.env.MANGO_CONFIG || '/etc/mango/config.yaml';
  const path = existsSync(configPath) ? configPath : resolve(repoRoot, 'config/config.example.yaml');
  if (!existsSync(path)) {
    return {};
  }
  const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown;
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
}

function configObject(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = raw[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function readSecret(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function positiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function loadYoutubeConfig(): YoutubeConfig {
  const root = readYamlConfig();
  const youtube = configObject(root, 'youtube');
  const playback = configObject(youtube, 'playback');
  const apiKeyFile = process.env.MANGO_YOUTUBE_API_KEY_FILE
    || optionalString(youtube.api_key_file)
    || '/etc/mango/youtube-api.key';
  const envApiKey = optionalString(process.env.MANGO_YOUTUBE_API_KEY);
  return {
    enabled: process.env.MANGO_YOUTUBE === '0' ? false : Boolean(youtube.enabled ?? true),
    db_path: process.env.MANGO_YOUTUBE_DB_PATH
      || optionalString(youtube.db_path)
      || '/etc/mango/youtube.db',
    api_key: envApiKey || readSecret(apiKeyFile),
    api_key_file: apiKeyFile,
    oauth_client_file: process.env.MANGO_YOUTUBE_OAUTH_CLIENT_FILE
      || optionalString(youtube.oauth_client_file)
      || '/etc/mango/youtube-oauth-client.json',
    auth_token_file: process.env.MANGO_YOUTUBE_AUTH_TOKEN_FILE
      || optionalString(youtube.auth_token_file)
      || '/etc/mango/youtube-auth.json',
    region_code: process.env.MANGO_YOUTUBE_REGION
      || optionalString(youtube.region_code)
      || 'US',
    relevance_language: process.env.MANGO_YOUTUBE_LANGUAGE
      || optionalString(youtube.relevance_language)
      || 'en',
    max_results: positiveInt(process.env.MANGO_YOUTUBE_MAX_RESULTS ?? youtube.max_results, 25, 1, 50),
    exclude_shorts: process.env.MANGO_YOUTUBE_INCLUDE_SHORTS === '1'
      ? false
      : Boolean(youtube.exclude_shorts ?? true),
    stale_after_ms: positiveInt(youtube.stale_after_hours, 24, 1, 24 * 30) * 60 * 60 * 1000,
    yt_dlp_command: process.env.MANGO_YTDLP_COMMAND
      || optionalString(playback.yt_dlp_command)
      || 'yt-dlp',
    yt_dlp_format: process.env.MANGO_YTDLP_FORMAT
      || optionalString(playback.yt_dlp_format)
      || 'best[height<=1080]/best',
    yt_dlp_cookies: process.env.MANGO_YTDLP_COOKIES
      || optionalString(playback.cookies_file),
    yt_dlp_cookies_from_browser: process.env.MANGO_YTDLP_COOKIES_FROM_BROWSER
      || optionalString(playback.cookies_from_browser),
  };
}

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type YoutubeRuntimeCanary = 'pass' | 'fail' | 'unknown';
export type YoutubeJsRuntimeKind = 'deno' | 'node' | 'none';

export type YoutubeRuntimeSnapshot = {
  slot_revision: string | null;
  slot_channel: 'stable' | 'nightly' | 'master' | 'unknown';
  slot_age_sec: number | null;
  ejs_ready: boolean;
  js_runtime: YoutubeJsRuntimeKind;
  pot_ready: boolean;
  cookies_configured: boolean;
  canary: YoutubeRuntimeCanary;
  rollback_available: boolean;
  fallback: 'none' | 'legacy_venv' | 'system';
};

type SlotMeta = {
  revision?: unknown;
  channel?: unknown;
  promoted_at?: unknown;
  ejs?: unknown;
  js_runtime?: unknown;
  canary?: unknown;
};

function homeDir(): string {
  return process.env.HOME || homedir();
}

export function youtubeSlotRoot(): string {
  return process.env.MANGO_YTDLP_SLOT_ROOT
    || join(homeDir(), '.local/share/mango/ytdlp-slots');
}

function readJson(path: string): SlotMeta | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as SlotMeta
      : null;
  } catch {
    return null;
  }
}

function slotChannel(value: unknown): YoutubeRuntimeSnapshot['slot_channel'] {
  return value === 'nightly' || value === 'master' || value === 'stable'
    ? value
    : 'unknown';
}

function canary(value: unknown): YoutubeRuntimeCanary {
  return value === 'pass' || value === 'fail' ? value : 'unknown';
}

function jsRuntime(value: unknown, denoPath: string | null): YoutubeJsRuntimeKind {
  if (value === 'deno' || value === 'node') return value;
  if (denoPath) return 'deno';
  return 'none';
}

export function detectDenoPath(): string | null {
  const configured = process.env.MANGO_YTDLP_DENO?.trim();
  if (configured && existsSync(configured)) return configured;
  const local = join(homeDir(), '.local/share/mango/deno/bin/deno');
  if (existsSync(local)) return local;
  const homeLocal = join(homeDir(), '.deno/bin/deno');
  if (existsSync(homeLocal)) return homeLocal;
  return null;
}

export function youtubePotBaseUrl(): string {
  return process.env.MANGO_YOUTUBE_POT_URL?.trim() || 'http://127.0.0.1:4416';
}

export function youtubePotEnabled(): boolean {
  return process.env.MANGO_YOUTUBE_POT !== '0';
}

export async function probeYoutubePotReady(timeoutMs = 250): Promise<boolean> {
  if (!youtubePotEnabled()) return false;
  const base = youtubePotBaseUrl().replace(/\/$/, '');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(base)) {
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/ping`, { signal: controller.signal });
    if (response.ok) return true;
    const fallback = await fetch(base, { signal: controller.signal });
    return fallback.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function readYoutubeRuntimeSnapshot(options: {
  cookiesConfigured: boolean;
  potReady?: boolean;
} ): YoutubeRuntimeSnapshot {
  const root = youtubeSlotRoot();
  const activeMeta = readJson(join(root, 'active', 'meta.json'))
    || readJson(join(root, 'active-meta.json'));
  const previousExists = existsSync(join(root, 'previous', 'venv/bin/yt-dlp'))
    || existsSync(join(root, 'previous', 'bin/yt-dlp'));
  const activeBin = existsSync(join(root, 'active', 'venv/bin/yt-dlp'));
  const legacyVenv = existsSync(join(homeDir(), '.local/share/mango/ytdlp-venv/bin/yt-dlp'));
  const promotedAt = Number(activeMeta?.promoted_at);
  const denoPath = detectDenoPath();
  return {
    slot_revision: typeof activeMeta?.revision === 'string' && activeMeta.revision.trim()
      ? activeMeta.revision.trim().slice(0, 64)
      : null,
    slot_channel: slotChannel(activeMeta?.channel),
    slot_age_sec: Number.isFinite(promotedAt) && promotedAt > 0
      ? Math.max(0, Math.floor((Date.now() - promotedAt) / 1000))
      : null,
    ejs_ready: activeMeta?.ejs === true,
    js_runtime: jsRuntime(activeMeta?.js_runtime, denoPath),
    pot_ready: options.potReady === true,
    cookies_configured: options.cookiesConfigured,
    canary: canary(activeMeta?.canary),
    rollback_available: previousExists,
    fallback: activeBin ? 'none' : legacyVenv ? 'legacy_venv' : 'system',
  };
}

export function youtubeRuntimeDiagnostics(snapshot: YoutubeRuntimeSnapshot): Record<string, unknown> {
  return {
    slot_revision: snapshot.slot_revision,
    slot_channel: snapshot.slot_channel,
    slot_age_sec: snapshot.slot_age_sec,
    ejs_ready: snapshot.ejs_ready,
    js_runtime: snapshot.js_runtime,
    pot_ready: snapshot.pot_ready,
    cookies_configured: snapshot.cookies_configured,
    canary: snapshot.canary,
    rollback_available: snapshot.rollback_available,
    fallback: snapshot.fallback,
  };
}

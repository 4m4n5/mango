import { readFile } from 'node:fs/promises';
import { tokenizeIntent } from '../ai-catalogs/compose.js';
import type { Meta } from '../core.js';

export type RailThemeProfile = {
  rail_id: string;
  intent: string;
  exclude: string;
  intent_tags: Set<string>;
  exclude_tags: Set<string>;
  min_fit: number;
  max_runtime_minutes?: number;
};

export type RailThemeConfig = {
  version: number;
  rails: Record<string, {
    intent: string;
    exclude?: string;
    min_fit?: number;
    max_runtime_minutes?: number;
  }>;
};

const ANCHOR_MIN_FIT = 3;
const DEFAULT_MIN_FIT = 8;

export function defaultRailThemePath(): string {
  if (process.env.MANGO_RAIL_THEME_PROFILES?.trim()) {
    return process.env.MANGO_RAIL_THEME_PROFILES.trim();
  }
  const repo = process.env.MANGO_REPO_DIR?.trim() || process.cwd();
  return `${repo}/config/rail-theme-profiles.yaml`;
}

export async function loadRailThemeProfiles(
  path = defaultRailThemePath(),
): Promise<Map<string, RailThemeProfile>> {
  const { parse } = await import('yaml');
  const raw = parse(await readFile(path, 'utf8')) as RailThemeConfig;
  const out = new Map<string, RailThemeProfile>();
  for (const [railId, profile] of Object.entries(raw.rails ?? {})) {
    out.set(railId, {
      rail_id: railId,
      intent: profile.intent ?? '',
      exclude: profile.exclude ?? '',
      intent_tags: tokenizeIntent(profile.intent ?? ''),
      exclude_tags: tokenizeIntent(profile.exclude ?? ''),
      min_fit: profile.min_fit ?? (railId.endsWith('-global-popular') ? ANCHOR_MIN_FIT : DEFAULT_MIN_FIT),
      max_runtime_minutes: profile.max_runtime_minutes,
    });
  }
  return out;
}

export function metaHaystack(meta: Meta | null, poolTitle?: string | null): string {
  const parts: string[] = [];
  if (poolTitle?.trim()) parts.push(poolTitle.trim());
  if (meta?.name && typeof meta.name === 'string') parts.push(meta.name);
  if (typeof meta?.genre === 'string') parts.push(meta.genre);
  if (Array.isArray(meta?.genres)) {
    for (const genre of meta.genres) {
      if (typeof genre === 'string') parts.push(genre);
    }
  }
  if (typeof meta?.description === 'string') parts.push(meta.description.slice(0, 280));
  if (typeof meta?.releaseInfo === 'string') parts.push(meta.releaseInfo);
  if (typeof meta?.country === 'string') parts.push(meta.country);
  if (Array.isArray(meta?.countries)) {
    for (const country of meta.countries) {
      if (typeof country === 'string') parts.push(country);
    }
  }
  if (typeof meta?.language === 'string') parts.push(meta.language);
  if (Array.isArray(meta?.languages)) {
    for (const language of meta.languages) {
      if (typeof language === 'string') parts.push(language);
    }
  }
  return parts.join(' ').toLowerCase();
}

export function parseRuntimeMinutes(meta: Meta | null): number | null {
  if (!meta) return null;
  const raw = meta.runtime ?? meta.runtimeMinutes;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const hours = raw.match(/(\d+)\s*h/i);
  const mins = raw.match(/(\d+)\s*m/i);
  const h = hours ? Number(hours[1]) : 0;
  const m = mins ? Number(mins[1]) : 0;
  if (h === 0 && m === 0) {
    const only = raw.match(/^\d+$/);
    return only ? Number(only[0]) : null;
  }
  return h * 60 + m;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function haystackHasThemeTag(haystack: string, tag: string): boolean {
  if (!tag) return false;
  const normalized = tag.toLowerCase().trim();
  if (!normalized) return false;
  if (
    normalized === 'india'
    && /\bindian[^a-z0-9]+(?:web[^a-z0-9]+)?(?:series|show|shows|tv|cinema|movie|movies|film|films)\b/i.test(haystack)
  ) {
    return true;
  }
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}([^a-z0-9]|$)`, 'i');
  return pattern.test(haystack);
}

export function scoreThematicFit(
  haystack: string,
  profile: RailThemeProfile,
  runtimeMinutes: number | null = null,
): number {
  let score = 0;
  for (const tag of profile.intent_tags) {
    if (tag.length < 3) continue;
    if (haystackHasThemeTag(haystack, tag)) {
      score += tag.length >= 6 ? 14 : 10;
    }
  }
  for (const tag of profile.exclude_tags) {
    if (tag.length < 3) continue;
    if (haystackHasThemeTag(haystack, tag)) {
      score -= tag.length >= 6 ? 22 : 16;
    }
  }
  if (
    profile.max_runtime_minutes
    && runtimeMinutes !== null
    && runtimeMinutes > profile.max_runtime_minutes
  ) {
    score -= 18;
  }
  return score;
}

export function bestRailForTitle(
  scores: Map<string, number>,
): { rail_id: string; score: number } | null {
  let best: { rail_id: string; score: number } | null = null;
  for (const [railId, score] of scores) {
    if (!best || score > best.score) {
      best = { rail_id: railId, score };
    }
  }
  return best;
}

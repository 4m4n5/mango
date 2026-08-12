import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  corpus_rule?: RailCorpusRule;
};

export const RAIL_CORPUS_RULES = [
  'genre_comedy',
  'genre_documentary',
  'country_india',
  'quick_light_movie',
  'format_miniseries',
  'genre_reality',
] as const;

export type RailCorpusRule = typeof RAIL_CORPUS_RULES[number];
export type RailCorpusRuleDecision = 'match' | 'conflict' | 'unknown';

export type RailThemeConfig = {
  version: number;
  rails: Record<string, {
    intent: string;
    exclude?: string;
    min_fit?: number;
    max_runtime_minutes?: number;
    corpus_rule?: RailCorpusRule;
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
    if (profile.corpus_rule !== undefined
      && !RAIL_CORPUS_RULES.includes(profile.corpus_rule)) {
      throw new Error(`unknown corpus_rule for ${railId}: ${String(profile.corpus_rule)}`);
    }
    out.set(railId, {
      rail_id: railId,
      intent: profile.intent ?? '',
      exclude: profile.exclude ?? '',
      intent_tags: tokenizeIntent(profile.intent ?? ''),
      exclude_tags: tokenizeIntent(profile.exclude ?? ''),
      min_fit: profile.min_fit ?? (railId.endsWith('-global-popular') ? ANCHOR_MIN_FIT : DEFAULT_MIN_FIT),
      max_runtime_minutes: profile.max_runtime_minutes,
      corpus_rule: profile.corpus_rule,
    });
  }
  return out;
}

export function railThemePolicyHash(profiles: ReadonlyMap<string, RailThemeProfile>): string {
  const resolved = [...profiles].sort(([left], [right]) => left.localeCompare(right)).map(
    ([railId, profile]) => ({
      rail_id: railId,
      intent: profile.intent,
      exclude: profile.exclude,
      min_fit: profile.min_fit,
      max_runtime_minutes: profile.max_runtime_minutes ?? null,
      corpus_rule: profile.corpus_rule ?? null,
    }),
  );
  return createHash('sha256').update(JSON.stringify(resolved)).digest('hex');
}

function normalizedValues(meta: Meta | null, singular: string, plural: string): string[] {
  if (!meta) return [];
  const values: unknown[] = [];
  const one = meta[singular];
  const many = meta[plural];
  if (typeof one === 'string') values.push(...one.split(','));
  if (Array.isArray(many)) values.push(...many);
  return [...new Set(values.flatMap((value) => (
    typeof value === 'string'
      ? [value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')]
      : []
  )).filter(Boolean))];
}

/** Exact structured-only admission. Descriptions and titles are never consulted. */
export function evaluateRailCorpusRule(
  rule: RailCorpusRule | undefined,
  meta: Meta | null,
): RailCorpusRuleDecision {
  if (!rule || !meta) return 'unknown';
  const genres = normalizedValues(meta, 'genre', 'genres');
  const countries = normalizedValues(meta, 'country', 'countries');
  const keywords = normalizedValues(meta, 'keyword', 'keywords');
  const runtime = parseRuntimeMinutes(meta);
  switch (rule) {
    case 'genre_comedy':
      return genres.includes('comedy') ? 'match' : genres.length > 0 ? 'conflict' : 'unknown';
    case 'genre_documentary':
      return genres.includes('documentary') ? 'match' : genres.length > 0 ? 'conflict' : 'unknown';
    case 'country_india':
      return countries.includes('india') ? 'match' : countries.length > 0 ? 'conflict' : 'unknown';
    case 'quick_light_movie': {
      const light = ['comedy', 'family', 'animation', 'romance', 'music'];
      if (runtime !== null && (runtime < 1 || runtime > 110)) return 'conflict';
      const thematic = genres.some((genre) => light.includes(genre));
      if (runtime !== null && thematic) return 'match';
      if (genres.length > 0 && !thematic) return 'conflict';
      return 'unknown';
    }
    case 'format_miniseries':
      return keywords.some((keyword) => keyword === 'miniseries' || keyword === 'limited series')
        ? 'match'
        : keywords.length > 0 ? 'conflict' : 'unknown';
    case 'genre_reality':
      return genres.includes('reality')
        || keywords.some((keyword) => keyword === 'reality tv' || keyword === 'game show')
        ? 'match'
        : genres.length > 0 || keywords.length > 0 ? 'conflict' : 'unknown';
  }
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
  const raw = meta.runtime ?? meta.runtimeMinutes ?? meta.runtime_minutes;
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

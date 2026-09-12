import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type ContentConfirmedReleaseOverride = {
  episode_id: string;
  behavior_filename: string;
};

export type TitleIdentityOverride = {
  country?: string;
  trusted_titles?: string[];
  require_explicit_edition?: boolean;
  content_confirmed_releases?: ContentConfirmedReleaseOverride[];
};

type OverrideConfig = {
  titles?: Record<string, TitleIdentityOverride>;
};

let cachedPath: string | null = null;
let cachedConfig: OverrideConfig | null = null;

function defaultConfigPath(): string {
  return resolve(new URL('../../../config/title-identity-overrides.yaml', import.meta.url).pathname);
}

function configPath(): string {
  return process.env.MANGO_TITLE_IDENTITY_OVERRIDES || defaultConfigPath();
}

function overrideSeriesId(normalizedKey: string): string | null {
  const match = normalizedKey.match(/^(?:series:)?(tt\d{5,10})$/);
  return match?.[1] ?? null;
}

function normalizeOverride(value: unknown, normalizedKey: string): TitleIdentityOverride | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const override: TitleIdentityOverride = {};
  if (typeof record.country === 'string' && record.country.trim()) {
    override.country = record.country.trim();
  }
  if (Array.isArray(record.trusted_titles)) {
    const trusted = record.trusted_titles
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());
    if (trusted.length > 0) override.trusted_titles = trusted;
  }
  if (typeof record.require_explicit_edition === 'boolean') {
    override.require_explicit_edition = record.require_explicit_edition;
  }
  if (Array.isArray(record.content_confirmed_releases)) {
    const seriesId = overrideSeriesId(normalizedKey);
    const releases = seriesId
      ? record.content_confirmed_releases
        .map((item): ContentConfirmedReleaseOverride | null => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
          const release = item as Record<string, unknown>;
          const episodeId = typeof release.episode_id === 'string'
            ? release.episode_id.trim().toLowerCase()
            : '';
          const filename = typeof release.behavior_filename === 'string'
            ? release.behavior_filename.trim()
            : '';
          if (!episodeId.startsWith(`${seriesId}:`) || !/^tt\d{5,10}:\d{1,3}:\d{1,3}$/.test(episodeId)) {
            return null;
          }
          if (!filename) return null;
          return { episode_id: episodeId, behavior_filename: filename };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
      : [];
    if (releases.length > 0) {
      override.content_confirmed_releases = releases;
    }
  }
  return Object.keys(override).length > 0 ? override : null;
}

function loadConfig(): OverrideConfig {
  const path = configPath();
  if (cachedConfig && cachedPath === path) {
    return cachedConfig;
  }
  cachedPath = path;
  cachedConfig = {};
  if (!existsSync(path)) {
    return cachedConfig;
  }
  const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return cachedConfig;
  }
  const titles = (parsed as { titles?: unknown }).titles;
  if (!titles || typeof titles !== 'object' || Array.isArray(titles)) {
    return cachedConfig;
  }
  const normalized: Record<string, TitleIdentityOverride> = {};
  for (const [key, value] of Object.entries(titles)) {
    const id = key.trim().toLowerCase();
    const override = normalizeOverride(value, id);
    if (id && override) {
      normalized[id] = override;
    }
  }
  cachedConfig = { titles: normalized };
  return cachedConfig;
}

export function titleIdentityOverride(type: string, id: string): TitleIdentityOverride | null {
  const normalizedType = type.trim().toLowerCase();
  const normalizedId = id.trim().toLowerCase();
  const config = loadConfig();
  return config.titles?.[`${normalizedType}:${normalizedId}`]
    ?? config.titles?.[normalizedId]
    ?? null;
}

export function resetTitleIdentityOverridesForTests(): void {
  cachedPath = null;
  cachedConfig = null;
}

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type TitleIdentityOverride = {
  country?: string;
  trusted_titles?: string[];
  require_explicit_edition?: boolean;
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

function normalizeOverride(value: unknown): TitleIdentityOverride | null {
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
    const override = normalizeOverride(value);
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

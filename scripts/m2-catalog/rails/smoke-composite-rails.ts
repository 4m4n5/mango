import { readFile } from 'node:fs/promises';
import {
  CompositeListSource,
  type ResolvedCatalogSource,
} from '../../src/catalog-service/src/playability/list-source.js';
import {
  loadRailConfig,
  type CompositeListRail,
} from '../../src/catalog-service/src/rails.js';

const MIN_CANDIDATES = Number(process.env.MANGO_COMPOSITE_MIN_CANDIDATES || 10);
const SMOKE_LIMIT = Number(process.env.MANGO_COMPOSITE_SMOKE_LIMIT || 40);
const EXPORT_PATH = process.env.MANGO_STREMIO_EXPORT || '/etc/mango/stremio-export.json';
const FETCH_TIMEOUT_MS = Number(process.env.MANGO_CATALOG_FETCH_TIMEOUT_MS || 20_000);

type ExportAddon = { name?: string; manifestUrl?: string };

function normalizeAddonName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeExportAddons(data: unknown): Array<{ name: string; manifestUrl: string }> {
  const root = data as { addons?: ExportAddon[] | { addons?: ExportAddon[] } };
  const raw = Array.isArray(root?.addons)
    ? root.addons
    : Array.isArray((root?.addons as { addons?: ExportAddon[] })?.addons)
      ? (root.addons as { addons: ExportAddon[] }).addons
      : [];
  return raw
    .map((addon) => {
      const manifestUrl = addon.manifestUrl?.trim();
      if (!manifestUrl) return null;
      return {
        name: (addon.name || new URL(manifestUrl).hostname).trim(),
        manifestUrl,
      };
    })
    .filter((addon): addon is { name: string; manifestUrl: string } => addon !== null);
}

async function fetchManifestName(manifestUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(manifestUrl, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`manifest HTTP ${response.status}`);
    }
    const manifest = await response.json() as { name?: string };
    return (manifest.name || manifestUrl).trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadManifestUrlByName(): Promise<Map<string, string>> {
  const exportData = JSON.parse(await readFile(EXPORT_PATH, 'utf8')) as unknown;
  const exported = normalizeExportAddons(exportData);
  const byName = new Map<string, string>();
  for (const addon of exported) {
    const manifestName = await fetchManifestName(addon.manifestUrl);
    byName.set(manifestName, addon.manifestUrl);
    byName.set(normalizeAddonName(manifestName), addon.manifestUrl);
    byName.set(addon.name, addon.manifestUrl);
    byName.set(normalizeAddonName(addon.name), addon.manifestUrl);
  }
  return byName;
}

function resolveManifestUrl(addonName: string, byName: Map<string, string>): string {
  const exact = byName.get(addonName);
  if (exact) return exact;
  const normalized = byName.get(normalizeAddonName(addonName));
  if (normalized) return normalized;
  throw new Error(`addon not found in export: ${addonName}`);
}

function resolvedSources(
  rail: CompositeListRail,
  byName: Map<string, string>,
): ResolvedCatalogSource[] {
  return rail.sources.map((source) => ({
    ...source,
    manifestUrl: resolveManifestUrl(source.addon, byName),
    sourceLabel: `${source.addon}/${source.catalog}`,
  }));
}

async function main(): Promise<void> {
  const [config, byName] = await Promise.all([
    loadRailConfig(),
    loadManifestUrlByName(),
  ]);

  const rails = config.rails.filter((rail): rail is CompositeListRail => (
    rail.enabled && rail.type === 'composite_list'
  ));
  if (rails.length === 0) {
    throw new Error('no composite_list rails configured');
  }

  let failures = 0;
  for (const rail of rails) {
    const source = new CompositeListSource(
      rail.id,
      rail.content_type,
      resolvedSources(rail, byName),
    );
    const started = Date.now();
    const candidates = await source.candidates({ offset: 0, limit: SMOKE_LIMIT });
    const ms = Date.now() - started;
    const ok = candidates.length >= MIN_CANDIDATES;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${rail.id}: ${candidates.length} candidates (${ms}ms) sources=${rail.sources.length}`,
    );
    if (!ok) failures += 1;
  }

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

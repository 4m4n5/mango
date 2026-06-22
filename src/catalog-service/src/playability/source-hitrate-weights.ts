import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ListSource } from './list-source.js';
import { CompositeListSource } from './list-source.js';
import { AiCatalogListSource } from '../ai-catalogs/list-source.js';
import { catalogSourceKey } from './source-cursors.js';

export type SourceHitrateEntry = {
  source_key: string;
  addon: string;
  catalog: string;
  content_type: string;
  sampled: number;
  stream_rate: number;
};

export type SourceHitrateReport = {
  ts: number;
  min_rate?: number;
  sources: SourceHitrateEntry[];
};

const DEFAULT_REPORT_PATH = join(homedir(), '.cache/mango/source-hitrate/latest.json');
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SAMPLES = 2;
const MIN_MULTIPLIER = 0.25;
const MAX_MULTIPLIER = 2.0;

export function growHitrateWeightsEnabled(): boolean {
  return process.env.MANGO_GROW_HITRATE_WEIGHTS !== '0';
}

export function sourceHitrateReportPath(): string {
  return process.env.MANGO_SOURCE_HITRATE_OUT?.trim() || DEFAULT_REPORT_PATH;
}

export function sourceHitrateMaxAgeMs(): number {
  const raw = process.env.MANGO_SOURCE_HITRATE_MAX_AGE_MS;
  if (raw === undefined || raw === '') {
    return DEFAULT_MAX_AGE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MAX_AGE_MS;
  }
  return parsed;
}

export function loadSourceHitrateReport(now = Date.now()): SourceHitrateReport | null {
  if (!growHitrateWeightsEnabled()) {
    return null;
  }
  try {
    const raw = readFileSync(sourceHitrateReportPath(), 'utf8');
    const report = JSON.parse(raw) as SourceHitrateReport;
    if (!Array.isArray(report.sources)) {
      return null;
    }
    const maxAge = sourceHitrateMaxAgeMs();
    if (maxAge > 0 && typeof report.ts === 'number' && now - report.ts > maxAge) {
      return null;
    }
    return report;
  } catch {
    return null;
  }
}

/** Map catalogSourceKey (addon:catalog) → weight multiplier from stream hit-rate. */
export function buildHitrateMultipliers(
  report: SourceHitrateReport,
  contentType: string,
): Map<string, number> {
  const baseline = report.min_rate ?? 0.5;
  const multipliers = new Map<string, number>();

  for (const entry of report.sources) {
    if (entry.content_type !== contentType) {
      continue;
    }
    if (!Number.isFinite(entry.sampled) || entry.sampled < MIN_SAMPLES) {
      continue;
    }
    const rate = entry.stream_rate;
    if (!Number.isFinite(rate) || rate <= 0) {
      multipliers.set(catalogSourceKey(entry.addon, entry.catalog), MIN_MULTIPLIER);
      continue;
    }
    const raw = rate / baseline;
    multipliers.set(
      catalogSourceKey(entry.addon, entry.catalog),
      Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, raw)),
    );
  }

  return multipliers;
}

export function loadHitrateMultipliersForContentType(
  contentType: string,
  now = Date.now(),
): Map<string, number> | null {
  const report = loadSourceHitrateReport(now);
  if (!report) {
    return null;
  }
  const multipliers = buildHitrateMultipliers(report, contentType);
  return multipliers.size > 0 ? multipliers : null;
}

export interface HitrateWeightedListSource {
  setHitrateWeightMultipliers(multipliers: Map<string, number>): void;
}

export function isHitrateWeightedListSource(
  source: ListSource,
): source is ListSource & HitrateWeightedListSource {
  return typeof (source as unknown as HitrateWeightedListSource).setHitrateWeightMultipliers === 'function';
}

/** Apply cached source-hitrate multipliers to composite / AI catalog list sources during grow. */
export function applyHitrateWeightsToListSource(
  source: ListSource,
  contentType: string,
  now = Date.now(),
): boolean {
  const multipliers = loadHitrateMultipliersForContentType(contentType, now);
  if (!multipliers || !isHitrateWeightedListSource(source)) {
    return false;
  }
  source.setHitrateWeightMultipliers(multipliers);
  return true;
}

export function effectiveSourceWeight(
  addon: string,
  catalog: string,
  baseWeight: number,
  multipliers: ReadonlyMap<string, number>,
): number {
  const mult = multipliers.get(catalogSourceKey(addon, catalog)) ?? 1;
  return Math.max(0.01, (baseWeight > 0 ? baseWeight : 1) * mult);
}

// Re-export for tests — ensure list sources implement the interface.
export { CompositeListSource, AiCatalogListSource };

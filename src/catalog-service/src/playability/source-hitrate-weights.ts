import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ListSource } from './list-source.js';
import { CompositeListSource } from './list-source.js';
import { AiCatalogListSource } from '../ai-catalogs/list-source.js';
import { catalogSourceKey } from './source-cursors.js';
import type { SourceIngestStats } from './candidate-ingest.js';

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

export type SourceGrowStats = SourceIngestStats & {
  content_type: string;
  verified: number;
  failed: number;
  theme_rejected: number;
};

export type SourceGrowEntry = SourceGrowStats & {
  runs: number;
  multiplier: number;
  last_ts: number;
  rollback_reason?: string;
};

export type SourceGrowReport = {
  ts: number;
  sources: SourceGrowEntry[];
  rail_outcomes?: Record<string, {
    target_met: boolean;
    last_ts: number;
    weighted: boolean;
  }>;
};

const DEFAULT_REPORT_PATH = join(homedir(), '.cache/mango/source-hitrate/latest.json');
const DEFAULT_GROW_REPORT_PATH = join(homedir(), '.cache/mango/source-grow/latest.json');
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_SAMPLES = 2;
const MIN_MULTIPLIER = 0.10;
const MAX_MULTIPLIER = 2.0;
const GROW_DECAY = 0.70;

export function growHitrateWeightsEnabled(): boolean {
  return process.env.MANGO_GROW_HITRATE_WEIGHTS !== '0';
}

export function sourceHitrateReportPath(): string {
  return process.env.MANGO_SOURCE_HITRATE_OUT?.trim() || DEFAULT_REPORT_PATH;
}

export function sourceGrowReportPath(): string {
  return process.env.MANGO_SOURCE_GROW_OUT?.trim() || DEFAULT_GROW_REPORT_PATH;
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

export function loadSourceGrowReport(now = Date.now()): SourceGrowReport | null {
  if (!growHitrateWeightsEnabled()) {
    return null;
  }
  try {
    const raw = readFileSync(sourceGrowReportPath(), 'utf8');
    const report = JSON.parse(raw) as SourceGrowReport;
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

export function buildSourceGrowMultipliers(
  report: SourceGrowReport,
  contentType: string,
): Map<string, number> {
  const multipliers = new Map<string, number>();
  for (const entry of report.sources) {
    if (entry.content_type !== contentType) {
      continue;
    }
    const samples = entry.fresh_queued + entry.linked_verified_seen + entry.failed + entry.theme_rejected;
    if (samples < MIN_SAMPLES) {
      continue;
    }
    multipliers.set(entry.source_key, clampMultiplier(entry.multiplier));
  }
  return multipliers;
}

export function loadHitrateMultipliersForContentType(
  contentType: string,
  now = Date.now(),
): Map<string, number> | null {
  const combined = new Map<string, number>();
  const report = loadSourceHitrateReport(now);
  if (report) {
    for (const [key, mult] of buildHitrateMultipliers(report, contentType)) {
      combined.set(key, mult);
    }
  }
  const growReport = loadSourceGrowReport(now);
  if (growReport) {
    for (const [key, mult] of buildSourceGrowMultipliers(growReport, contentType)) {
      const existing = combined.get(key);
      combined.set(key, existing === undefined ? mult : clampMultiplier((existing + mult) / 2));
    }
  }
  return combined.size > 0 ? combined : null;
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

export function recordSourceGrowOutcome(
  railId: string,
  contentType: string,
  stats: SourceGrowStats[],
  options: { growTargetMet: boolean; weighted: boolean; now?: number },
): void {
  if (!growHitrateWeightsEnabled() || stats.length === 0) {
    return;
  }
  const now = options.now ?? Date.now();
  const previous = loadSourceGrowReport(now) ?? { ts: now, sources: [] };
  const bySource = new Map(previous.sources.map((entry) => [entry.source_key, entry]));
  const previousOutcome = previous.rail_outcomes?.[railId];
  const shouldRollback = Boolean(
    previousOutcome?.target_met
      && !options.growTargetMet
      && previousOutcome.weighted,
  );

  for (const stat of stats) {
    const existing = bySource.get(stat.source_key);
    const merged = mergeGrowStats(existing, stat, contentType, now);
    if (shouldRollback) {
      merged.multiplier = 1;
      merged.rollback_reason = `rail ${railId} regressed after weighted success`;
    }
    bySource.set(stat.source_key, merged);
  }

  const report: SourceGrowReport = {
    ts: now,
    sources: [...bySource.values()].sort((a, b) => a.source_key.localeCompare(b.source_key)),
    rail_outcomes: {
      ...(previous.rail_outcomes ?? {}),
      [railId]: {
        target_met: options.growTargetMet,
        last_ts: now,
        weighted: options.weighted,
      },
    },
  };
  try {
    const path = sourceGrowReportPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch {
    // Runtime source weights are advisory; grow must not fail because cache writes fail.
  }
}

function mergeGrowStats(
  existing: SourceGrowEntry | undefined,
  stat: SourceGrowStats,
  contentType: string,
  now: number,
): SourceGrowEntry {
  const decayed = existing
    ? {
      scanned: existing.scanned * GROW_DECAY,
      fresh_queued: existing.fresh_queued * GROW_DECAY,
      skipped_verified: existing.skipped_verified * GROW_DECAY,
      skipped_recent_failed: existing.skipped_recent_failed * GROW_DECAY,
      linked_verified_seen: existing.linked_verified_seen * GROW_DECAY,
      requested: existing.requested * GROW_DECAY,
      returned: existing.returned * GROW_DECAY,
      catalog_errors: existing.catalog_errors * GROW_DECAY,
      rate_limited: existing.rate_limited * GROW_DECAY,
      verified: existing.verified * GROW_DECAY,
      failed: existing.failed * GROW_DECAY,
      theme_rejected: existing.theme_rejected * GROW_DECAY,
      runs: existing.runs,
    }
    : {
      scanned: 0,
      fresh_queued: 0,
      skipped_verified: 0,
      skipped_recent_failed: 0,
      linked_verified_seen: 0,
      requested: 0,
      returned: 0,
      catalog_errors: 0,
      rate_limited: 0,
      verified: 0,
      failed: 0,
      theme_rejected: 0,
      runs: 0,
    };

  const merged: SourceGrowEntry = {
    ...stat,
    content_type: contentType,
    scanned: Math.round(decayed.scanned + stat.scanned),
    fresh_queued: Math.round(decayed.fresh_queued + stat.fresh_queued),
    skipped_verified: Math.round(decayed.skipped_verified + stat.skipped_verified),
    skipped_recent_failed: Math.round(decayed.skipped_recent_failed + stat.skipped_recent_failed),
    linked_verified_seen: Math.round(decayed.linked_verified_seen + stat.linked_verified_seen),
    requested: Math.round(decayed.requested + stat.requested),
    returned: Math.round(decayed.returned + stat.returned),
    catalog_errors: Math.round(decayed.catalog_errors + stat.catalog_errors),
    rate_limited: Math.round(decayed.rate_limited + stat.rate_limited),
    verified: Math.round(decayed.verified + stat.verified),
    failed: Math.round(decayed.failed + stat.failed),
    theme_rejected: Math.round(decayed.theme_rejected + stat.theme_rejected),
    exhausted: stat.exhausted || Boolean(existing?.exhausted && stat.returned === 0),
    runs: decayed.runs + 1,
    multiplier: sourceGrowMultiplier({
      fresh_queued: decayed.fresh_queued + stat.fresh_queued,
      linked_verified_seen: decayed.linked_verified_seen + stat.linked_verified_seen,
      verified: decayed.verified + stat.verified,
      failed: decayed.failed + stat.failed,
      theme_rejected: decayed.theme_rejected + stat.theme_rejected,
      catalog_errors: decayed.catalog_errors + stat.catalog_errors,
      rate_limited: decayed.rate_limited + stat.rate_limited,
      exhausted: stat.exhausted,
    }),
    last_ts: now,
  };
  return merged;
}

function sourceGrowMultiplier(stats: {
  fresh_queued: number;
  linked_verified_seen: number;
  verified: number;
  failed: number;
  theme_rejected: number;
  catalog_errors: number;
  rate_limited: number;
  exhausted: boolean;
}): number {
  const attempted = Math.max(1, stats.fresh_queued + stats.failed + stats.theme_rejected);
  const verifiedYield = stats.verified / attempted;
  const linkedYield = Math.min(0.5, stats.linked_verified_seen / Math.max(1, stats.linked_verified_seen + attempted));
  const themePenalty = stats.theme_rejected / attempted;
  const failurePenalty = stats.failed / attempted;
  const infraPenalty = Math.min(1, (stats.catalog_errors + stats.rate_limited * 2) / Math.max(1, attempted));
  const raw = 0.75 + verifiedYield * 2.0 + linkedYield - themePenalty - failurePenalty * 0.35 - infraPenalty;
  const exhaustedPenalty = stats.exhausted && stats.verified <= 0 ? 0.5 : 1;
  return clampMultiplier(raw * exhaustedPenalty);
}

function clampMultiplier(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, value));
}

// Re-export for tests — ensure list sources implement the interface.
export { CompositeListSource, AiCatalogListSource };

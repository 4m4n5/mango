import type { BrowsableRail, CatalogSourceRef } from '../rails.js';
import { isAddonRateLimitMessage, isBlockedCatalogText } from '../catalog-errors.js';
import {
  allocateSourceLimits,
  mergeCompositeCandidates,
  type WeightedCandidateBatch,
} from './composite-merge.js';
import { effectiveSourceWeight } from './source-hitrate-weights.js';
import {
  AI_SEED_CURSOR_KEY,
  catalogSourceKey,
  type SourceCursorListSource,
} from './source-cursors.js';
import { canonicalTitleId } from './ids.js';

export type ListSourceType = 'addon_catalog' | 'composite_list' | 'ai_catalog';

export type CandidateMeta = {
  id: string;
  type: string;
  title?: string;
  poster?: string;
  year?: number | string;
  source?: string;
  source_name?: string;
  source_key?: string;
  source_addon?: string;
  source_catalog?: string;
};

export interface ListSource {
  readonly sourceId: string;
  readonly sourceType: ListSourceType;
  candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]>;
}

export type ListSourceFetchStats = {
  source_key: string;
  source_label: string;
  requested: number;
  returned: number;
  errors: number;
  rate_limited: number;
  exhausted: boolean;
};

export interface SourceStatsListSource {
  readLastSourceFetchStats(): ListSourceFetchStats[];
}

export interface SuppressibleListSource {
  setSuppressedSourceKeys(keys: ReadonlySet<string>): void;
  readSuppressedSourceKeys(): ReadonlySet<string>;
}

export type ResolvedCatalogSource = CatalogSourceRef & {
  manifestUrl: string;
  sourceLabel: string;
  sourceName?: string;
};

export function resourceUrl(manifestUrl: string, resource: string, type: string, id: string): string {
  const encodedType = encodeURIComponent(type);
  const encodedId = encodeURIComponent(id);
  const url = new URL(manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/${resource}/${encodedType}/${encodedId}.json`;
  url.hash = '';
  return url.toString();
}

/** Stremio catalog pagination — skip is passed to the addon, not applied client-side only. */
export function catalogResourceUrl(
  manifestUrl: string,
  contentType: string,
  catalog: string,
  options: { skip?: number } = {},
): string {
  const skip = Math.max(0, options.skip ?? 0);
  if (skip <= 0) {
    return resourceUrl(manifestUrl, 'catalog', contentType, catalog);
  }
  const encodedType = encodeURIComponent(contentType);
  const encodedId = encodeURIComponent(catalog);
  const url = new URL(manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/catalog/${encodedType}/${encodedId}/skip=${skip}.json`;
  url.hash = '';
  return url.toString();
}

function previewId(preview: unknown): string | null {
  if (typeof preview !== 'object' || preview === null) return null;
  const id = (preview as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

function previewTitle(preview: unknown): string | undefined {
  if (typeof preview !== 'object' || preview === null) return undefined;
  const name = (preview as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
}

function previewPoster(preview: unknown): string | undefined {
  if (typeof preview !== 'object' || preview === null) return undefined;
  const poster = (preview as { poster?: unknown }).poster;
  return typeof poster === 'string' && poster.trim() !== '' ? poster.trim() : undefined;
}

function previewYear(preview: unknown): number | string | undefined {
  if (typeof preview !== 'object' || preview === null) return undefined;
  const row = preview as { year?: unknown; releaseInfo?: unknown; released?: unknown };
  if (typeof row.year === 'number' && Number.isFinite(row.year)) return row.year;
  if (typeof row.year === 'string' && row.year.trim() !== '') return row.year.trim();
  for (const value of [row.releaseInfo, row.released]) {
    if (typeof value !== 'string') continue;
    const match = value.match(/\b(19|20)\d{2}\b/);
    if (match) return match[0];
  }
  return undefined;
}

const CATALOG_FETCH_TIMEOUT_MS = Number(process.env.MANGO_CATALOG_FETCH_TIMEOUT_MS || 20_000);
const DEFAULT_PROBATION_MULTIPLIER = 0.08;
const DEFAULT_COMPOSITE_FETCH_CONCURRENCY = 4;

export function compositeCatalogFetchConcurrency(): number {
  const raw = process.env.MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY;
  if (raw === undefined || raw === '') {
    return DEFAULT_COMPOSITE_FETCH_CONCURRENCY;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_COMPOSITE_FETCH_CONCURRENCY;
  }
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

function growSourceProbationMultiplier(): number {
  const raw = process.env.MANGO_GROW_SOURCE_PROBATION_MULTIPLIER;
  if (raw === undefined || raw === '') {
    return DEFAULT_PROBATION_MULTIPLIER;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0.05 || parsed > 0.10) {
    return DEFAULT_PROBATION_MULTIPLIER;
  }
  return parsed;
}

export async function fetchAddonCatalogCandidates(
  manifestUrl: string,
  contentType: string,
  catalog: string,
  sourceLabel: string,
  options: { offset: number; limit: number },
  source?: { sourceKey?: string; addon?: string; catalog?: string; sourceName?: string },
): Promise<CandidateMeta[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(catalogResourceUrl(
      manifestUrl,
      contentType,
      catalog,
      { skip: options.offset },
    ), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`catalog ${sourceLabel} failed: HTTP ${response.status}`);
    }
    const data = await response.json() as { metas?: unknown[] };
    return (data.metas || [])
      .slice(0, options.limit)
      .filter((preview) => {
        const title = previewTitle(preview);
        return !title || !isBlockedCatalogText(title);
      })
      .map((preview): CandidateMeta | null => {
        const id = previewId(preview);
        if (!id) return null;
        return {
          id: canonicalTitleId(contentType, id),
          type: contentType,
          title: previewTitle(preview),
          poster: previewPoster(preview),
          year: previewYear(preview),
          source: sourceLabel,
          source_name: source?.sourceName,
          source_key: source?.sourceKey,
          source_addon: source?.addon,
          source_catalog: source?.catalog,
        };
      })
      .filter((candidate): candidate is CandidateMeta => candidate !== null);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`catalog ${sourceLabel} failed: timeout after ${CATALOG_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export class AddonCatalogListSource implements ListSource, SourceCursorListSource {
  readonly sourceType = 'addon_catalog' as const;
  private sourceOffsets = new Map<string, number>();
  private catalogExhausted = false;
  private suppressedSources = new Set<string>();
  private lastFetchStats: ListSourceFetchStats[] = [];

  constructor(
    readonly sourceId: string,
    private readonly addonName: string,
    private readonly contentType: string,
    private readonly catalog: string,
    private readonly manifestUrl: string,
    private readonly sourceLabel: string,
    private readonly sourceName?: string,
  ) {}

  static fromRail(
    rail: Extract<BrowsableRail, { type: 'addon_catalog' }>,
    manifestUrl: string,
  ): AddonCatalogListSource {
    return new AddonCatalogListSource(
      rail.id,
      rail.addon,
      rail.content_type,
      rail.catalog,
      manifestUrl,
      `${rail.addon}/${rail.catalog}`,
    );
  }

  listSourceKeys(): string[] {
    return [catalogSourceKey(this.addonName, this.catalog)];
  }

  readSourceOffsets(): ReadonlyMap<string, number> {
    return this.sourceOffsets;
  }

  setSuppressedSourceKeys(keys: ReadonlySet<string>): void {
    this.suppressedSources = new Set(keys);
  }

  readSuppressedSourceKeys(): ReadonlySet<string> {
    return this.suppressedSources;
  }

  writeSourceOffsets(offsets: Map<string, number>): void {
    this.sourceOffsets = new Map(offsets);
    this.catalogExhausted = false;
  }

  resetAllSourceOffsets(): void {
    for (const key of this.listSourceKeys()) {
      this.sourceOffsets.set(key, 0);
    }
    this.catalogExhausted = false;
  }

  areAllSourcesExhausted(): boolean {
    return this.catalogExhausted || this.suppressedSources.has(this.cursorKey());
  }

  private cursorKey(): string {
    return catalogSourceKey(this.addonName, this.catalog);
  }

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    const start = this.sourceOffsets.get(this.cursorKey()) ?? options.offset;
    const key = this.cursorKey();
    this.lastFetchStats = [];
    if (this.suppressedSources.has(key)) {
      this.lastFetchStats.push({
        source_key: key,
        source_label: this.sourceLabel,
        requested: 0,
        returned: 0,
        errors: 0,
        rate_limited: 0,
        exhausted: true,
      });
      return [];
    }
    let candidates: CandidateMeta[] = [];
    try {
      candidates = await fetchAddonCatalogCandidates(
        this.manifestUrl,
        this.contentType,
        this.catalog,
        this.sourceLabel,
        { offset: start, limit: options.limit },
        {
          sourceKey: key,
          addon: this.addonName,
          catalog: this.catalog,
          sourceName: this.sourceName,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.catalogExhausted = true;
      this.lastFetchStats.push({
        source_key: key,
        source_label: this.sourceLabel,
        requested: options.limit,
        returned: 0,
        errors: 1,
        rate_limited: isAddonRateLimitMessage(message) ? 1 : 0,
        exhausted: true,
      });
      throw error;
    }
    this.sourceOffsets.set(this.cursorKey(), start + candidates.length);
    if (candidates.length < options.limit) {
      this.catalogExhausted = true;
    }
    this.lastFetchStats.push({
      source_key: key,
      source_label: this.sourceLabel,
      requested: options.limit,
      returned: candidates.length,
      errors: 0,
      rate_limited: 0,
      exhausted: this.catalogExhausted,
    });
    return candidates;
  }

  readLastSourceFetchStats(): ListSourceFetchStats[] {
    return [...this.lastFetchStats];
  }
}

export class CompositeListSource implements ListSource, SourceCursorListSource {
  readonly sourceType = 'composite_list' as const;
  private sourceOffsets = new Map<string, number>();
  private exhaustedSources = new Set<string>();
  private suppressedSources = new Set<string>();
  private hitrateWeightMultipliers = new Map<string, number>();
  private lastFetchStats: ListSourceFetchStats[] = [];
  private probationCursor = 0;

  constructor(
    readonly sourceId: string,
    private readonly contentType: string,
    private readonly sources: ResolvedCatalogSource[],
  ) {}

  setHitrateWeightMultipliers(multipliers: Map<string, number>): void {
    this.hitrateWeightMultipliers = new Map(multipliers);
  }

  private sourceWeight(source: ResolvedCatalogSource): number {
    return effectiveSourceWeight(
      source.addon,
      source.catalog,
      source.weight ?? 1,
      this.hitrateWeightMultipliers,
    );
  }

  listSourceKeys(): string[] {
    return this.sources.map((source) => catalogSourceKey(source.addon, source.catalog));
  }

  readSourceOffsets(): ReadonlyMap<string, number> {
    return this.sourceOffsets;
  }

  setSuppressedSourceKeys(keys: ReadonlySet<string>): void {
    this.suppressedSources = new Set(keys);
  }

  readSuppressedSourceKeys(): ReadonlySet<string> {
    return this.suppressedSources;
  }

  writeSourceOffsets(offsets: Map<string, number>): void {
    this.sourceOffsets = new Map(offsets);
    this.exhaustedSources.clear();
  }

  resetAllSourceOffsets(): void {
    for (const key of this.listSourceKeys()) {
      this.sourceOffsets.set(key, 0);
    }
    this.exhaustedSources.clear();
  }

  areAllSourcesExhausted(): boolean {
    const keys = this.listSourceKeys();
    return keys.length > 0 && keys.every((key) => (
      this.exhaustedSources.has(key) || this.suppressedSources.has(key)
    ));
  }

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    if (this.sources.length === 0) {
      return [];
    }
    return this.candidatesWithSourceCursors(options.limit);
  }

  private async candidatesWithSourceCursors(limit: number): Promise<CandidateMeta[]> {
    const weights = this.sources.map((source) => this.sourceWeight(source));
    const perSourceLimits = allocateSourceLimits(limit, weights, {
      probationStartIndex: this.probationCursor,
    });
    const probationFloor = growSourceProbationMultiplier();
    const probationFetches = perSourceLimits.filter((value, index) => (
      value > 0 && weights[index] <= probationFloor + 0.0001
    )).length;
    this.probationCursor += probationFetches;
    const batches: Array<WeightedCandidateBatch | undefined> = new Array(this.sources.length);
    const stats: Array<ListSourceFetchStats | undefined> = new Array(this.sources.length);
    const fetchPlans: Array<{
      index: number;
      source: ResolvedCatalogSource;
      key: string;
      start: number;
      fetchLimit: number;
      weight: number;
    }> = [];

    const emptyBatch = (
      index: number,
      source: ResolvedCatalogSource,
      weight: number,
    ): WeightedCandidateBatch => ({
      sourceIndex: index,
      sourceLabel: source.sourceLabel,
      weight,
      candidates: [],
    });

    for (const [index, source] of this.sources.entries()) {
      const key = catalogSourceKey(source.addon, source.catalog);
      const start = this.sourceOffsets.get(key) ?? 0;
      const fetchLimit = perSourceLimits[index] ?? 1;
      const weight = this.sourceWeight(source);
      if (fetchLimit <= 0) {
        stats[index] = {
          source_key: key,
          source_label: source.sourceLabel,
          requested: 0,
          returned: 0,
          errors: 0,
          rate_limited: 0,
          exhausted: this.exhaustedSources.has(key),
        };
        batches[index] = emptyBatch(index, source, weight);
        continue;
      }
      if (this.exhaustedSources.has(key) || this.suppressedSources.has(key)) {
        stats[index] = {
          source_key: key,
          source_label: source.sourceLabel,
          requested: 0,
          returned: 0,
          errors: 0,
          rate_limited: 0,
          exhausted: true,
        };
        batches[index] = emptyBatch(index, source, weight);
        continue;
      }
      fetchPlans.push({ index, source, key, start, fetchLimit, weight });
    }

    let nextPlan = 0;
    const workerCount = Math.min(compositeCatalogFetchConcurrency(), fetchPlans.length);
    async function next(): Promise<void> {
      while (nextPlan < fetchPlans.length) {
        const plan = fetchPlans[nextPlan];
        nextPlan += 1;
        if (!plan) {
          continue;
        }
        await fetchPlan(plan);
      }
    }

    const fetchPlan = async (plan: typeof fetchPlans[number]): Promise<void> => {
      const { index, source, key, start, fetchLimit, weight } = plan;
      try {
        const candidates = await fetchAddonCatalogCandidates(
          source.manifestUrl,
          this.contentType,
          source.catalog,
          source.sourceLabel,
          { offset: start, limit: fetchLimit },
          {
            sourceKey: key,
            addon: source.addon,
            catalog: source.catalog,
            sourceName: source.sourceName,
          },
        );
        this.sourceOffsets.set(key, start + candidates.length);
        if (candidates.length < fetchLimit) {
          this.exhaustedSources.add(key);
        }
        stats[index] = {
          source_key: key,
          source_label: source.sourceLabel,
          requested: fetchLimit,
          returned: candidates.length,
          errors: 0,
          rate_limited: 0,
          exhausted: this.exhaustedSources.has(key),
        };
        batches[index] = {
          sourceIndex: index,
          sourceLabel: source.sourceLabel,
          weight,
          candidates,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `composite source skipped rail=${this.sourceId} source=${source.sourceLabel}: ${
            message
          }`,
        );
        this.exhaustedSources.add(key);
        stats[index] = {
          source_key: key,
          source_label: source.sourceLabel,
          requested: fetchLimit,
          returned: 0,
          errors: 1,
          rate_limited: isAddonRateLimitMessage(message) ? 1 : 0,
          exhausted: true,
        };
        batches[index] = {
          sourceIndex: index,
          sourceLabel: source.sourceLabel,
          weight,
          candidates: [],
        };
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => next()));

    this.lastFetchStats = stats.filter((stat): stat is ListSourceFetchStats => stat !== undefined);
    for (const [index, source] of this.sources.entries()) {
      if (!batches[index]) {
        batches[index] = emptyBatch(index, source, this.sourceWeight(source));
      }
    }

    return mergeCompositeCandidates(
      batches.filter((batch): batch is WeightedCandidateBatch => batch !== undefined),
      limit,
      0,
    );
  }

  readLastSourceFetchStats(): ListSourceFetchStats[] {
    return [...this.lastFetchStats];
  }
}

export function isSourceStatsListSource(source: ListSource): source is ListSource & SourceStatsListSource {
  return typeof (source as unknown as SourceStatsListSource).readLastSourceFetchStats === 'function';
}

export function isSuppressibleListSource(source: ListSource): source is ListSource & SuppressibleListSource {
  return typeof (source as unknown as SuppressibleListSource).setSuppressedSourceKeys === 'function';
}

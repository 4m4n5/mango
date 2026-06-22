import type { BrowsableRail, CatalogSourceRef } from '../rails.js';
import { isBlockedCatalogText } from '../catalog-errors.js';
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

export type ListSourceType = 'addon_catalog' | 'composite_list' | 'ai_catalog';

export type CandidateMeta = {
  id: string;
  type: string;
  title?: string;
  poster?: string;
  source?: string;
};

export interface ListSource {
  readonly sourceId: string;
  readonly sourceType: ListSourceType;
  candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]>;
}

export type ResolvedCatalogSource = CatalogSourceRef & {
  manifestUrl: string;
  sourceLabel: string;
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

const CATALOG_FETCH_TIMEOUT_MS = Number(process.env.MANGO_CATALOG_FETCH_TIMEOUT_MS || 20_000);

export async function fetchAddonCatalogCandidates(
  manifestUrl: string,
  contentType: string,
  catalog: string,
  sourceLabel: string,
  options: { offset: number; limit: number },
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
          id,
          type: contentType,
          title: previewTitle(preview),
          poster: previewPoster(preview),
          source: sourceLabel,
        };
      })
      .filter((candidate): candidate is CandidateMeta => candidate !== null);
  } finally {
    clearTimeout(timeout);
  }
}

export class AddonCatalogListSource implements ListSource, SourceCursorListSource {
  readonly sourceType = 'addon_catalog' as const;
  private sourceOffsets = new Map<string, number>();
  private catalogExhausted = false;

  constructor(
    readonly sourceId: string,
    private readonly addonName: string,
    private readonly contentType: string,
    private readonly catalog: string,
    private readonly manifestUrl: string,
    private readonly sourceLabel: string,
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
    return this.catalogExhausted;
  }

  private cursorKey(): string {
    return catalogSourceKey(this.addonName, this.catalog);
  }

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    const start = this.sourceOffsets.get(this.cursorKey()) ?? options.offset;
    const candidates = await fetchAddonCatalogCandidates(
      this.manifestUrl,
      this.contentType,
      this.catalog,
      this.sourceLabel,
      { offset: start, limit: options.limit },
    );
    this.sourceOffsets.set(this.cursorKey(), start + candidates.length);
    if (candidates.length < options.limit) {
      this.catalogExhausted = true;
    }
    return candidates;
  }
}

export class CompositeListSource implements ListSource, SourceCursorListSource {
  readonly sourceType = 'composite_list' as const;
  private sourceOffsets = new Map<string, number>();
  private exhaustedSources = new Set<string>();
  private hitrateWeightMultipliers = new Map<string, number>();

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
    return keys.length > 0 && keys.every((key) => this.exhaustedSources.has(key));
  }

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    if (this.sources.length === 0) {
      return [];
    }
    return this.candidatesWithSourceCursors(options.limit);
  }

  private async candidatesWithSourceCursors(limit: number): Promise<CandidateMeta[]> {
    const weights = this.sources.map((source) => this.sourceWeight(source));
    const perSourceLimits = allocateSourceLimits(limit, weights);
    const batches: WeightedCandidateBatch[] = [];

    for (const [index, source] of this.sources.entries()) {
      const key = catalogSourceKey(source.addon, source.catalog);
      const start = this.sourceOffsets.get(key) ?? 0;
      const fetchLimit = perSourceLimits[index] ?? 1;
      try {
        const candidates = await fetchAddonCatalogCandidates(
          source.manifestUrl,
          this.contentType,
          source.catalog,
          source.sourceLabel,
          { offset: start, limit: fetchLimit },
        );
        this.sourceOffsets.set(key, start + candidates.length);
        if (candidates.length < fetchLimit) {
          this.exhaustedSources.add(key);
        }
        batches.push({
          sourceIndex: index,
          sourceLabel: source.sourceLabel,
          weight: this.sourceWeight(source),
          candidates,
        });
      } catch (error) {
        console.warn(
          `composite source skipped rail=${this.sourceId} source=${source.sourceLabel}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        this.exhaustedSources.add(key);
        batches.push({
          sourceIndex: index,
          sourceLabel: source.sourceLabel,
          weight: this.sourceWeight(source),
          candidates: [],
        });
      }
    }

    return mergeCompositeCandidates(batches, limit, 0);
  }
}

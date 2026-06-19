import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowsableRail, CatalogSourceRef } from '../rails.js';
import {
  allocateSourceLimits,
  mergeCompositeCandidates,
  type WeightedCandidateBatch,
} from './composite-merge.js';

export type ListSourceType = 'addon_catalog' | 'composite_list' | 'ai_catalog' | 'static_ids' | 'tmdb_list';

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

const DEFAULT_AI_CATALOG_DIR = '/etc/mango/ai-catalogs';

function normalizeCandidate(value: unknown, fallbackType: string, sourceId: string): CandidateMeta | null {
  if (typeof value === 'string') {
    const id = value.trim();
    return id ? { id, type: fallbackType, source: sourceId } : null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.trim() !== '' ? record.id.trim() : null;
  if (!id) return null;
  const type = typeof record.type === 'string' && record.type.trim() !== ''
    ? record.type.trim()
    : fallbackType;
  return {
    id,
    type,
    title: typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim() : undefined,
    poster: typeof record.poster === 'string' && record.poster.trim() !== '' ? record.poster.trim() : undefined,
    source: sourceId,
  };
}

export function resourceUrl(manifestUrl: string, resource: string, type: string, id: string): string {
  const encodedType = encodeURIComponent(type);
  const encodedId = encodeURIComponent(id);
  const url = new URL(manifestUrl);
  const root = url.pathname.replace(/\/manifest\.json$/, '').replace(/\/$/, '');
  url.pathname = `${root}/${resource}/${encodedType}/${encodedId}.json`;
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
    const response = await fetch(resourceUrl(
      manifestUrl,
      'catalog',
      contentType,
      catalog,
    ), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`catalog ${sourceLabel} failed: HTTP ${response.status}`);
    }
    const data = await response.json() as { metas?: unknown[] };
    return (data.metas || [])
      .slice(options.offset, options.offset + options.limit)
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

export class AddonCatalogListSource implements ListSource {
  readonly sourceType = 'addon_catalog' as const;

  constructor(
    readonly sourceId: string,
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
      rail.content_type,
      rail.catalog,
      manifestUrl,
      `${rail.addon}/${rail.catalog}`,
    );
  }

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    return fetchAddonCatalogCandidates(
      this.manifestUrl,
      this.contentType,
      this.catalog,
      this.sourceLabel,
      options,
    );
  }
}

export class CompositeListSource implements ListSource {
  readonly sourceType = 'composite_list' as const;

  constructor(
    readonly sourceId: string,
    private readonly contentType: string,
    private readonly sources: ResolvedCatalogSource[],
  ) {}

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    const ingestLimit = options.offset + options.limit;
    const weights = this.sources.map((source) => source.weight);
    const perSourceLimits = allocateSourceLimits(ingestLimit, weights);
    const batches: WeightedCandidateBatch[] = [];

    for (const [index, source] of this.sources.entries()) {
      const fetchLimit = perSourceLimits[index] ?? 1;
      try {
        const candidates = await fetchAddonCatalogCandidates(
          source.manifestUrl,
          this.contentType,
          source.catalog,
          source.sourceLabel,
          { offset: 0, limit: fetchLimit },
        );
        batches.push({
          sourceIndex: index,
          sourceLabel: source.sourceLabel,
          weight: source.weight,
          candidates,
        });
      } catch (error) {
        console.warn(
          `composite source skipped rail=${this.sourceId} source=${source.sourceLabel}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        batches.push({
          sourceIndex: index,
          sourceLabel: source.sourceLabel,
          weight: source.weight,
          candidates: [],
        });
      }
    }

    return mergeCompositeCandidates(batches, options.limit, options.offset);
  }
}

export class StaticIdsListSource implements ListSource {
  readonly sourceType = 'static_ids' as const;

  constructor(
    readonly sourceId: string,
    private readonly items: CandidateMeta[],
  ) {}

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    return this.items.slice(options.offset, options.offset + options.limit);
  }
}

export class AiCatalogListSource implements ListSource {
  readonly sourceType = 'ai_catalog' as const;

  constructor(
    readonly sourceId: string,
    private readonly options: {
      dir?: string;
      fallbackType?: string;
    } = {},
  ) {}

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    if (!/^[A-Za-z0-9_.-]+$/.test(this.sourceId)) {
      throw new Error(`invalid ai catalog id: ${this.sourceId}`);
    }
    const root = this.options.dir || process.env.MANGO_AI_CATALOG_DIR || DEFAULT_AI_CATALOG_DIR;
    const fallbackType = this.options.fallbackType || 'movie';
    const raw = await readFile(join(root, `${this.sourceId}.json`), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];
    return items
      .map((item) => normalizeCandidate(item, fallbackType, this.sourceId))
      .filter((candidate): candidate is CandidateMeta => candidate !== null)
      .slice(options.offset, options.offset + options.limit);
  }
}

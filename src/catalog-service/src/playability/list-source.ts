import type { AddonCatalogRail } from '../rails.js';

export type ListSourceType = 'addon_catalog' | 'ai_catalog' | 'static_ids' | 'tmdb_list';

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

function resourceUrl(manifestUrl: string, resource: string, type: string, id: string): string {
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

export class AddonCatalogListSource implements ListSource {
  readonly sourceType = 'addon_catalog' as const;

  constructor(
    readonly sourceId: string,
    private readonly rail: AddonCatalogRail,
    private readonly manifestUrl: string,
  ) {}

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    const response = await fetch(resourceUrl(
      this.manifestUrl,
      'catalog',
      this.rail.content_type,
      this.rail.catalog,
    ), { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`catalog ${this.sourceId} failed: HTTP ${response.status}`);
    }
    const data = await response.json() as { metas?: unknown[] };
    return (data.metas || [])
      .slice(options.offset, options.offset + options.limit)
      .map((preview): CandidateMeta | null => {
        const id = previewId(preview);
        if (!id) return null;
        return {
          id,
          type: this.rail.content_type,
          title: previewTitle(preview),
          poster: previewPoster(preview),
          source: this.sourceId,
        };
      })
      .filter((candidate): candidate is CandidateMeta => candidate !== null);
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

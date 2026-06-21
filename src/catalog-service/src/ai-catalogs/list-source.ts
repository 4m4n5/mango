import type { ListSource, CandidateMeta, ResolvedCatalogSource } from '../playability/list-source.js';
import {
  allocateSourceLimits,
  mergeCompositeCandidates,
  type WeightedCandidateBatch,
} from '../playability/composite-merge.js';
import { fetchAddonCatalogCandidates } from '../playability/list-source.js';
import type { AiCatalogLlmHints, AiSeedTitle } from './types.js';

export type AiCatalogListSourceOptions = {
  sourceId: string;
  contentType: string;
  seedTitles: AiSeedTitle[];
  sources: ResolvedCatalogSource[];
  llmHints?: AiCatalogLlmHints;
};

function seedKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function seedToCandidate(seed: AiSeedTitle, contentType: string): CandidateMeta {
  return {
    id: seed.id,
    type: seed.type || contentType,
    title: seed.title,
    poster: seed.poster,
    source: 'ai_seed',
  };
}

export class AiCatalogListSource implements ListSource {
  readonly sourceType = 'ai_catalog' as const;
  readonly sourceId: string;

  private readonly contentType: string;
  private readonly seeds: AiSeedTitle[];
  private readonly sources: ResolvedCatalogSource[];

  constructor(options: AiCatalogListSourceOptions) {
    this.sourceId = options.sourceId;
    this.contentType = options.contentType;
    this.seeds = mergeSeedTitles(options.seedTitles, options.contentType, options.llmHints);
    this.sources = options.sources;
  }

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    const seedCandidates = this.seeds.map((seed) => seedToCandidate(seed, this.contentType));
    const { offset, limit } = options;
    if (offset < seedCandidates.length) {
      const fromSeeds = seedCandidates.slice(offset, offset + limit);
      if (fromSeeds.length >= limit || this.sources.length === 0) {
        return fromSeeds.slice(0, limit);
      }
      const addon = await this.fetchAddonCandidates({
        offset: 0,
        limit: limit - fromSeeds.length,
      });
      return dedupeCandidates([...fromSeeds, ...addon]).slice(0, limit);
    }

    if (this.sources.length === 0) {
      return [];
    }
    return this.fetchAddonCandidates({
      offset: offset - seedCandidates.length,
      limit,
    });
  }

  private async fetchAddonCandidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
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
          `ai catalog source skipped rail=${this.sourceId} source=${source.sourceLabel}: ${
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

export function mergeSeedTitles(
  seedTitles: AiSeedTitle[],
  contentType: string,
  hints?: AiCatalogLlmHints,
): AiSeedTitle[] {
  const merged = new Map<string, AiSeedTitle>();
  for (const seed of seedTitles) {
    merged.set(seedKey(seed.type, seed.id), seed);
  }
  for (const id of hints?.add_ids ?? []) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    const key = seedKey(contentType, trimmed);
    if (!merged.has(key)) {
      merged.set(key, { type: contentType, id: trimmed });
    }
  }
  return [...merged.values()];
}

function dedupeCandidates(candidates: CandidateMeta[]): CandidateMeta[] {
  const seen = new Set<string>();
  const out: CandidateMeta[] = [];
  for (const candidate of candidates) {
    const key = seedKey(candidate.type, candidate.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function mergeSeedLists(
  left: AiSeedTitle[],
  right: AiSeedTitle[],
): AiSeedTitle[] {
  const merged = new Map<string, AiSeedTitle>();
  for (const seed of [...left, ...right]) {
    merged.set(seedKey(seed.type, seed.id), {
      ...merged.get(seedKey(seed.type, seed.id)),
      ...seed,
    });
  }
  return [...merged.values()];
}

export function mergeCatalogSources(
  left: AiCatalogListSourceOptions['sources'],
  right: ResolvedCatalogSource[],
): ResolvedCatalogSource[] {
  const merged = new Map<string, ResolvedCatalogSource>();
  for (const source of [...left, ...right]) {
    const key = `${source.addon}:${source.catalog}`;
    merged.set(key, { ...merged.get(key), ...source });
  }
  return [...merged.values()];
}

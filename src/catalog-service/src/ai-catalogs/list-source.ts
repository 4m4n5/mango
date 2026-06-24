import type { ListSource, CandidateMeta, ResolvedCatalogSource } from '../playability/list-source.js';
import {
  AI_SEED_CURSOR_KEY,
  catalogSourceKey,
  type SourceCursorListSource,
} from '../playability/source-cursors.js';
import {
  allocateSourceLimits,
  mergeCompositeCandidates,
  type WeightedCandidateBatch,
} from '../playability/composite-merge.js';
import { fetchAddonCatalogCandidates } from '../playability/list-source.js';
import { effectiveSourceWeight } from '../playability/source-hitrate-weights.js';
import { canonicalTitleId } from '../playability/ids.js';
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
  const type = seed.type || contentType;
  return {
    id: canonicalTitleId(type, seed.id),
    type,
    title: seed.title,
    poster: seed.poster,
    source: 'ai_seed',
  };
}

export class AiCatalogListSource implements ListSource, SourceCursorListSource {
  readonly sourceType = 'ai_catalog' as const;
  readonly sourceId: string;

  private readonly contentType: string;
  private readonly seeds: AiSeedTitle[];
  private readonly sources: ResolvedCatalogSource[];
  private sourceOffsets = new Map<string, number>();
  private exhaustedSources = new Set<string>();
  private suppressedSources = new Set<string>();
  private hitrateWeightMultipliers = new Map<string, number>();

  constructor(options: AiCatalogListSourceOptions) {
    this.sourceId = options.sourceId;
    this.contentType = options.contentType;
    this.seeds = mergeSeedTitles(options.seedTitles, options.contentType, options.llmHints);
    this.sources = options.sources;
  }

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
    const keys = [AI_SEED_CURSOR_KEY];
    for (const source of this.sources) {
      keys.push(catalogSourceKey(source.addon, source.catalog));
    }
    return keys;
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
    const seedCount = this.seeds.length;
    const seedDone = (this.sourceOffsets.get(AI_SEED_CURSOR_KEY) ?? 0) >= seedCount;
    if (this.sources.length === 0) {
      return seedDone;
    }
    const addonKeys = this.sources.map((source) => catalogSourceKey(source.addon, source.catalog));
    return seedDone && addonKeys.every((key) => (
      this.exhaustedSources.has(key) || this.suppressedSources.has(key)
    ));
  }

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    const seedCandidates = this.seeds.map((seed) => seedToCandidate(seed, this.contentType));
    const seedStart = this.sourceOffsets.get(AI_SEED_CURSOR_KEY) ?? 0;
    const { limit } = options;
    const collected: CandidateMeta[] = [];

    if (seedStart < seedCandidates.length) {
      const fromSeeds = seedCandidates.slice(seedStart, seedStart + limit);
      collected.push(...fromSeeds);
      this.sourceOffsets.set(AI_SEED_CURSOR_KEY, seedStart + fromSeeds.length);
      if (collected.length >= limit || this.sources.length === 0) {
        return dedupeCandidates(collected).slice(0, limit);
      }
    }

    if (this.sources.length === 0) {
      return dedupeCandidates(collected).slice(0, limit);
    }

    const addon = await this.fetchAddonCandidates(limit - collected.length);
    return dedupeCandidates([...collected, ...addon]).slice(0, limit);
  }

  private async fetchAddonCandidates(limit: number): Promise<CandidateMeta[]> {
    const weights = this.sources.map((source) => this.sourceWeight(source));
    const perSourceLimits = allocateSourceLimits(limit, weights);
    const batches: WeightedCandidateBatch[] = [];

    for (const [index, source] of this.sources.entries()) {
      const key = catalogSourceKey(source.addon, source.catalog);
      const start = this.sourceOffsets.get(key) ?? 0;
      const fetchLimit = perSourceLimits[index] ?? 1;
      if (this.suppressedSources.has(key)) {
        batches.push({
          sourceIndex: index,
          sourceLabel: source.sourceLabel,
          weight: this.sourceWeight(source),
          candidates: [],
        });
        continue;
      }
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
          `ai catalog source skipped rail=${this.sourceId} source=${source.sourceLabel}: ${
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

export function mergeSeedTitles(
  seedTitles: AiSeedTitle[],
  contentType: string,
  hints?: AiCatalogLlmHints,
): AiSeedTitle[] {
  const merged = new Map<string, AiSeedTitle>();
  for (const seed of seedTitles) {
    const type = seed.type || contentType;
    const id = canonicalTitleId(type, seed.id);
    merged.set(seedKey(type, id), { ...seed, type, id });
  }
  for (const id of hints?.add_ids ?? []) {
    const trimmed = canonicalTitleId(contentType, id);
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

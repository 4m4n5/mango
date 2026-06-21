import type { CatalogSourceRef, CatalogTab } from '../rails.js';
import type { VoiceSearchHit } from '../voice/search.js';
import type { AiCatalogLlmHints, AiSeedTitle } from './types.js';
import {
  deployedCatalogIds,
  loadAiCatalogReserve,
  loadMdbListInventory,
  reserveCatalogIds,
  type MdbListCatalogRow,
  type MdbListInventory,
} from './inventory.js';

export type ComposeInput = {
  label: string;
  tab: CatalogTab;
  content_type: 'movie' | 'series';
  theme?: string;
  seed_hints?: AiSeedTitle[];
};

export type ComposePlan = {
  seed_titles: AiSeedTitle[];
  sources: CatalogSourceRef[];
  llm_hints: AiCatalogLlmHints;
  catalogs_to_activate: string[];
  fallback_level: number;
  thematic_score: number;
};

const INTENT_KEYWORDS: Array<[string, string]> = [
  ['horror', 'horror'],
  ['thriller', 'thriller'],
  ['comedy', 'comedy'],
  ['documentary', 'documentary'],
  ['hindi', 'hindi'],
  ['india', 'india'],
  ['indian', 'india'],
  ['anime', 'anime'],
  ['sci-fi', 'sci-fi'],
  ['scifi', 'sci-fi'],
  ['science fiction', 'sci-fi'],
  ['crime', 'crime'],
  ['romance', 'romance'],
  ['action', 'action'],
  ['family', 'family'],
  ['animation', 'animation'],
  ['animated', 'animation'],
  ['stand up', 'stand-up'],
  ['stand-up', 'stand-up'],
  ['miniseries', 'limited-series'],
  ['limited series', 'limited-series'],
  ['true crime', 'true-crime'],
  ['latest', 'trending'],
  ['new', 'trending'],
];

const ADJACENT_TAGS: Record<string, string[]> = {
  horror: ['thriller', 'mindfuck'],
  comedy: ['stand-up', 'animation'],
  'sci-fi': ['science', 'animation'],
  hindi: ['india'],
  india: ['hindi'],
};

const BROAD_MDBLIST = 'mdblist.88302';
const CINEMETA_TOP: CatalogSourceRef = { addon: 'Cinemeta', catalog: 'top', weight: 1 };

export function tokenizeIntent(text: string): Set<string> {
  const lower = text.toLowerCase();
  const tags = new Set<string>();
  for (const [needle, tag] of INTENT_KEYWORDS) {
    if (lower.includes(needle)) {
      tags.add(tag);
    }
  }
  for (const word of lower.split(/[^a-z0-9]+/).filter((part) => part.length >= 3)) {
    tags.add(word);
  }
  return tags;
}

function mediaMatches(row: MdbListCatalogRow, contentType: 'movie' | 'series'): boolean {
  const media = row.media ?? 'mixed';
  if (media === 'mixed') {
    return true;
  }
  return media === contentType;
}

export function scoreInventoryRow(
  row: MdbListCatalogRow,
  intentTags: Set<string>,
  contentType: 'movie' | 'series',
  reserveIds: Set<string>,
  deployedIds: Set<string>,
): number {
  if (!mediaMatches(row, contentType)) {
    return -1;
  }
  const rowTags = new Set(row.tags ?? []);
  let tagOverlap = 0;
  for (const tag of intentTags) {
    if (rowTags.has(tag)) {
      tagOverlap += 1;
    }
  }
  const hitRate = typeof row.hit_rate?.source === 'number' ? row.hit_rate.source : 0.45;
  const popularity = Math.log10(Math.max(1, row.popularity ?? 1));
  const items = row.items ?? 0;
  let score = tagOverlap * 3;
  score += hitRate * 5;
  score += popularity * 2;
  if (items >= 100) {
    score += 1;
  }
  if (reserveIds.has(row.catalog_id)) {
    score += 2;
  }
  if (deployedIds.has(row.catalog_id)) {
    score += 2;
  }
  if (rowTags.has('demoted')) {
    score -= 10;
  }
  return score;
}

function normalizeWeights(sources: CatalogSourceRef[]): CatalogSourceRef[] {
  if (sources.length === 0) {
    return sources;
  }
  const total = sources.reduce((sum, source) => sum + (source.weight ?? 1), 0);
  return sources.map((source) => ({
    ...source,
    weight: Number(((source.weight ?? 1) / total).toFixed(4)),
  }));
}

function mdblistSource(catalogId: string, weight: number): CatalogSourceRef {
  return { addon: 'AIOMetadata', catalog: catalogId, weight };
}

function pickSources(
  inventory: MdbListInventory,
  intentTags: Set<string>,
  contentType: 'movie' | 'series',
  reserveIds: Set<string>,
  deployedIds: Set<string>,
  fallbackLevel: number,
): { sources: CatalogSourceRef[]; catalogs_to_activate: string[]; thematic_score: number } {
  const ranked = inventory.catalogs
    .map((row) => ({
      row,
      score: scoreInventoryRow(row, intentTags, contentType, reserveIds, deployedIds),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  if (fallbackLevel >= 3) {
    return {
      sources: [CINEMETA_TOP],
      catalogs_to_activate: [],
      thematic_score: 0.1,
    };
  }

  const tagMatched = ranked.filter((entry) => {
    const rowTags = new Set(entry.row.tags ?? []);
    for (const tag of intentTags) {
      if (rowTags.has(tag)) {
        return true;
      }
    }
    return false;
  });

  let picks = tagMatched.slice(0, 3);
  if (picks.length === 0 && fallbackLevel >= 1) {
    const adjacent = new Set<string>();
    for (const tag of intentTags) {
      for (const neighbor of ADJACENT_TAGS[tag] ?? []) {
        adjacent.add(neighbor);
      }
    }
    picks = ranked.filter((entry) => (entry.row.tags ?? []).some((tag) => adjacent.has(tag))).slice(0, 2);
  }
  if (picks.length === 0 && fallbackLevel >= 2) {
    picks = ranked.filter((entry) => entry.score > 0).slice(0, 1);
    if (picks.length === 0 && inventory.catalogs.some((row) => row.catalog_id === BROAD_MDBLIST)) {
      picks = [{ row: { catalog_id: BROAD_MDBLIST, tags: ['trending'] }, score: 0.2 }];
    }
  }

  const weights = picks.length === 1
    ? [1]
    : picks.length === 2
      ? [0.7, 0.3]
      : [0.6, 0.25, 0.15];
  const sources = picks.map((entry, index) => mdblistSource(entry.row.catalog_id, weights[index] ?? 0.1));
  const maxTagScore = Math.max(0, ...picks.map((entry) => entry.score));
  const thematic_score = Math.min(1, maxTagScore / 10);
  return {
    sources: normalizeWeights(sources),
    catalogs_to_activate: picks.map((entry) => entry.row.catalog_id),
    thematic_score,
  };
}

function hitsToSeeds(hits: VoiceSearchHit[], contentType: 'movie' | 'series'): AiSeedTitle[] {
  return hits
    .filter((hit) => hit.tab === contentType || hit.tab === 'movies' || hit.tab === 'series')
    .filter((hit) => hit.type === contentType || contentType === 'movie')
    .map((hit) => ({
      type: hit.type,
      id: hit.id,
      title: hit.title,
      poster: hit.poster,
      score: hit.score,
    }));
}

export type ComposeDeps = {
  searchLibrary: (query: string, limit?: number) => Promise<VoiceSearchHit[]>;
  searchExternal?: (query: string, limit?: number) => Promise<VoiceSearchHit[]>;
  inventory?: MdbListInventory;
  reserveIds?: Set<string>;
  minFallbackLevel?: number;
};

export async function resolveAiCatalogPlan(
  input: ComposeInput,
  deps: ComposeDeps,
): Promise<ComposePlan> {
  const inventory = deps.inventory ?? loadMdbListInventory();
  const reserveIds = deps.reserveIds ?? reserveCatalogIds(loadAiCatalogReserve());
  const deployedIds = deployedCatalogIds(inventory);
  const intentText = [input.label, input.theme].filter(Boolean).join(' ');
  const intentTags = tokenizeIntent(intentText);
  const fallbackLevel = deps.minFallbackLevel ?? 0;

  const { sources, catalogs_to_activate, thematic_score } = pickSources(
    inventory,
    intentTags,
    input.content_type,
    reserveIds,
    deployedIds,
    fallbackLevel,
  );

  const query = input.theme?.trim() || input.label.trim();
  const libraryHits = await deps.searchLibrary(query, 12);
  let seeds = hitsToSeeds(libraryHits, input.content_type);
  if (seeds.length < 3 && deps.searchExternal) {
    const externalHits = await deps.searchExternal(query, 8);
    seeds = [...seeds, ...hitsToSeeds(externalHits, input.content_type)];
  }
  if (input.seed_hints?.length) {
    seeds = [...input.seed_hints, ...seeds];
  }

  const seen = new Set<string>();
  seeds = seeds.filter((seed) => {
    const key = `${seed.type}:${seed.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 12);

  if (sources.length === 0 && seeds.length < 3) {
    throw new Error('compose could not find sources or enough thematic seed candidates');
  }

  return {
    seed_titles: seeds,
    sources,
    llm_hints: {
      theme: input.theme?.trim() || input.label.trim(),
      topup_suggestions: [
        `Keep ${input.label.trim()} rail thematic — prefer ${[...intentTags].slice(0, 4).join(', ') || 'matching'} titles on top-up`,
      ],
      updated_at: new Date().toISOString(),
    },
    catalogs_to_activate,
    fallback_level: fallbackLevel,
    thematic_score,
  };
}

export function slotNeedsCompose(slot: {
  seed_titles?: AiSeedTitle[];
  sources?: CatalogSourceRef[];
}): boolean {
  const seedCount = slot.seed_titles?.length ?? 0;
  const sourceCount = slot.sources?.length ?? 0;
  return seedCount === 0 && sourceCount === 0;
}

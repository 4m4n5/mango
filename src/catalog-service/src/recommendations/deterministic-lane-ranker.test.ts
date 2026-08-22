import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignLane,
  computeCorpusIdf,
  explicitAnchorStrength,
  positiveEvidence,
  rankDeterministicLanes,
  sparseCosineIdf,
  type DeterministicLaneIdentity,
  type DeterministicLaneItem,
} from './deterministic-lane-ranker.js';
import {
  positiveRatingEvidence,
  storyRatingAnchorStrength,
} from './story-graph-v1.js';

const AS_OF = 1_000_000_000_000;

function features(pairs: Record<string, number>): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const [key, value] of Object.entries(pairs)) {
    if (value !== 0) map.set(key, value);
  }
  return map;
}

function makeItem(
  id: string,
  title: string,
  featureMap: Record<string, number>,
  overrides: Partial<DeterministicLaneItem> = {},
): DeterministicLaneItem {
  const type: 'movie' | 'series' = overrides.type ?? 'movie';
  return {
    identity: `${type}:${id}` as DeterministicLaneIdentity,
    id,
    title,
    type,
    features: features(featureMap),
    fire: null,
    water: null,
    implicit: null,
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// Fire/Water contract parity with story-graph-v1
// -------------------------------------------------------------------------

test('positiveEvidence matches story-graph-v1.positiveRatingEvidence across the 0..5 half-step grid', () => {
  for (let r = 0; r <= 10; r += 1) {
    const rating = r / 2;
    const local = positiveEvidence(rating);
    const canonical = positiveRatingEvidence(rating);
    assert.equal(local, canonical,
      `positiveEvidence(${rating}) diverged from story-graph-v1: ${local} vs ${canonical}`);
  }
});

test('explicitAnchorStrength matches storyRatingAnchorStrength across the half-step grid', () => {
  const grid = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  for (const fire of grid) {
    for (const water of grid) {
      const local = explicitAnchorStrength(fire, water);
      const canonical = storyRatingAnchorStrength(fire, water);
      assert.equal(local, canonical,
        `explicitAnchorStrength(${fire}, ${water}) diverged: ${local} vs ${canonical}`);
    }
  }
});

test('2.5/3/3.5 ratings all contribute positive evidence, 1-2 stay neutral', () => {
  assert.ok(positiveEvidence(2.5) > 0, 'r=2.5 must be positive');
  assert.ok(positiveEvidence(3) > 0, 'r=3 must be positive');
  assert.ok(positiveEvidence(3.5) > 0, 'r=3.5 must be positive');
  assert.equal(positiveEvidence(1), 0, 'r=1 is neutral');
  assert.equal(positiveEvidence(1.5), 0, 'r=1.5 is neutral');
  assert.equal(positiveEvidence(2), 0, 'r=2 is neutral');
  assert.equal(positiveEvidence(0.5), 0, 'r=0.5 clamps to 0 evidence');
});

// -------------------------------------------------------------------------
// Sparse collapse / support rules
// -------------------------------------------------------------------------

test('any positive anchor (r=3 alone) yields exactly one lane, not zero', () => {
  const items: DeterministicLaneItem[] = [
    makeItem('lone', 'Lone Positive', { crime: 1 }, { fire: 3, water: 3 }),
    makeItem('n1', 'Neutral 1', { crime: 0.9 }, { fire: 2, water: 2 }),
    makeItem('n2', 'Neutral 2', { drama: 1 }),
    makeItem('n3', 'Neutral 3', { drama: 0.9 }),
  ];
  const result = rankDeterministicLanes({ items, as_of: AS_OF });
  assert.equal(result.lanes, 1, 'one positive must produce one lane');
  assert.ok(result.seeds.includes('movie:lone'), 'the sole positive must be the seed');
  assert.ok(result.slate.length >= 1);
});

test('two singleton clusters collapse to one lane, not two', () => {
  const items: DeterministicLaneItem[] = [
    makeItem('a', 'Alpha', { crime: 1 }, { fire: 4, water: 4 }),
    makeItem('b', 'Beta', { romance: 1 }, { fire: 4, water: 4 }),
    makeItem('c', 'Charlie', { crime: 0.9, drama: 0.1 }),
    makeItem('d', 'Delta', { romance: 0.9, comedy: 0.1 }),
  ];
  const result = rankDeterministicLanes({ items, as_of: AS_OF, min_support_per_lane: 2 });
  assert.equal(result.lanes, 1, 'singleton clusters must collapse to one lane');
  assert.ok(result.decisions.some((d) => d.startsWith('collapsed_to_one_lane')));
});

test('both lanes >=2 anchors emit two lanes with 3+3 slate', () => {
  const items: DeterministicLaneItem[] = [
    makeItem('crime-1', 'Crime One', { crime: 1 }, { fire: 5, water: 5 }),
    makeItem('crime-2', 'Crime Two', { crime: 0.9, procedural: 0.1 }, { fire: 4, water: 4 }),
    makeItem('crime-3', 'Crime Three', { crime: 0.85 }),
    makeItem('crime-4', 'Crime Four', { crime: 0.8, procedural: 0.2 }),
    makeItem('rom-1', 'Romance One', { romance: 1 }, { fire: 4, water: 5 }),
    makeItem('rom-2', 'Romance Two', { romance: 0.9, comedy: 0.1 }, { fire: 4, water: 4 }),
    makeItem('rom-3', 'Romance Three', { romance: 0.85 }),
    makeItem('rom-4', 'Romance Four', { romance: 0.8, comedy: 0.2 }),
  ];
  const result = rankDeterministicLanes({ items, as_of: AS_OF, min_support_per_lane: 2 });
  assert.equal(result.lanes, 2);
  assert.equal(result.slate.length, 6);
  const laneCounts = new Map<number, number>();
  for (const entry of result.slate) laneCounts.set(entry.lane, (laneCounts.get(entry.lane) ?? 0) + 1);
  assert.deepEqual([...laneCounts.values()].sort(), [3, 3]);
});

// -------------------------------------------------------------------------
// Full ranked universe (every candidate scored, not just slate+reserve)
// -------------------------------------------------------------------------

test('ranked output covers the full non-excluded candidate universe', () => {
  const CANDIDATES = 6_000;
  const VOCAB = 800;
  const FEATURES_PER_ITEM = 6;
  const items: DeterministicLaneItem[] = [];
  for (let i = 0; i < CANDIDATES; i += 1) {
    const pairs: Record<string, number> = {};
    for (let f = 0; f < FEATURES_PER_ITEM; f += 1) {
      const key = `k${((i * 11 + f * 97) % VOCAB).toString(16)}`;
      pairs[key] = 0.5 + ((i + f) % 5) / 10;
    }
    const overrides: Partial<DeterministicLaneItem> = i < 6
      ? { fire: 5, water: 4.5 }
      : i < 12
        ? { fire: 4.5, water: 5, features: features({ ...pairs, offaxis: 1 }) }
        : {};
    items.push(makeItem(`c${i.toString(16)}`, `Candidate ${i}`, pairs, overrides));
  }
  const result = rankDeterministicLanes({ items, as_of: AS_OF });
  assert.equal(result.ranked.length, CANDIDATES,
    `ranked must cover the full candidate universe (${result.ranked.length}/${CANDIDATES})`);
  const scored = new Set(result.ranked.map((entry) => entry.identity));
  assert.equal(scored.size, CANDIDATES, 'no duplicate identities in ranked');
  const laneCoverage = new Set(result.ranked.map((entry) => entry.lane));
  assert.ok(laneCoverage.size >= 1 && laneCoverage.size <= 2,
    'ranked entries live on 1 or 2 lanes when lanes > 0');
  // Every ranked score must be finite and derived from centroid, not
  // seed-only. A score of exactly 0 is fine for candidates with no
  // feature overlap; NaN/Infinity is not.
  for (const entry of result.ranked) {
    assert.ok(Number.isFinite(entry.score), `score must be finite for ${entry.identity}`);
  }
});

// -------------------------------------------------------------------------
// Adapter / pure assignment identity
// -------------------------------------------------------------------------

test('assignments map matches assignLane recomputed from exported helper', () => {
  const items: DeterministicLaneItem[] = [
    makeItem('a', 'Alpha', { crime: 1 }, { fire: 5, water: 5 }),
    makeItem('b', 'Beta', { crime: 0.9, procedural: 0.1 }, { fire: 4, water: 4 }),
    makeItem('c', 'Charlie', { romance: 1 }, { fire: 5, water: 4.5 }),
    makeItem('d', 'Delta', { romance: 0.9, comedy: 0.1 }, { fire: 4, water: 4 }),
    makeItem('e', 'Echo', { crime: 0.5, romance: 0.5 }),
    makeItem('f', 'Foxtrot', { procedural: 0.7, drama: 0.3 }),
    makeItem('g', 'Golf', { comedy: 1 }),
  ];
  const result = rankDeterministicLanes({ items, as_of: AS_OF });
  assert.ok(result.lanes >= 1);
  const idf = computeCorpusIdf(items);
  const seedItems = result.seeds
    .slice(0, result.lanes)
    .map((seedIdentity) => items.find((i) => i.identity === seedIdentity)!);
  for (const item of items) {
    const recomputed = assignLane(item.features, seedItems, idf);
    const recorded = result.assignments.get(item.identity);
    assert.equal(recomputed, recorded,
      `assignLane parity broken for ${item.identity}: recomputed ${recomputed} vs ranker ${recorded}`);
  }
});

// -------------------------------------------------------------------------
// IDF preference for rare features
// -------------------------------------------------------------------------

test('IDF weighting prefers rare shared features over generic format matches', () => {
  const items: DeterministicLaneItem[] = [];
  items.push(makeItem('anchor', 'Anchor', { format_series: 1, rare_theme: 1 }, {
    fire: 5, water: 4.5,
  }));
  // Rival candidate shares only the generic `format_series` feature.
  items.push(makeItem('generic', 'Generic Match', { format_series: 1, generic_drama: 1 }));
  // Preferred candidate shares the rare theme.
  items.push(makeItem('rare-match', 'Rare Match', { format_series: 1, rare_theme: 1, generic_drama: 0.5 }));
  // Pad the corpus so `format_series` becomes very common and thus low-IDF.
  for (let i = 0; i < 50; i += 1) {
    items.push(makeItem(`pad-${i}`, `Pad ${i}`, { format_series: 1, generic_drama: 0.4 }));
  }
  const result = rankDeterministicLanes({ items, as_of: AS_OF, min_support_per_lane: 1 });
  const ranked = result.ranked.filter((entry) => entry.identity !== 'movie:anchor');
  const rareIndex = ranked.findIndex((entry) => entry.identity === 'movie:rare-match');
  const genericIndex = ranked.findIndex((entry) => entry.identity === 'movie:generic');
  assert.ok(rareIndex >= 0 && genericIndex >= 0);
  assert.ok(rareIndex < genericIndex,
    `rare-feature match should outrank generic-format match (rare=${rareIndex}, generic=${genericIndex})`);
});

test('computeCorpusIdf memory stays vocab-sized regardless of corpus size', () => {
  const items: DeterministicLaneItem[] = [];
  for (let i = 0; i < 5_000; i += 1) {
    items.push(makeItem(`c${i}`, `Cand ${i}`, {
      shared_a: 1,
      shared_b: 0.5,
      [`unique_${i}`]: 1,
    }));
  }
  const idf = computeCorpusIdf(items);
  // Vocabulary is `shared_a`, `shared_b`, and 5000 unique keys = 5002.
  assert.equal(idf.size, 5_002);
  const shared = idf.get('shared_a')!;
  const rare = idf.get('unique_0')!;
  assert.ok(rare > shared,
    `rare features (${rare}) must weigh at least as much as universally shared (${shared})`);
  assert.ok(shared >= 1 && rare <= 4, 'IDF must be bounded to [1, IDF_MAX]');
});

// -------------------------------------------------------------------------
// Order invariance
// -------------------------------------------------------------------------

test('rank is order-invariant under input shuffle including full ranked list', () => {
  const items: DeterministicLaneItem[] = [
    makeItem('a', 'Alpha', { crime: 1 }, { fire: 5, water: 5 }),
    makeItem('b', 'Beta', { crime: 0.95, drama: 0.05 }, { fire: 4, water: 4 }),
    makeItem('c', 'Charlie', { crime: 0.9, drama: 0.1 }, { fire: 5, water: 4 }),
    makeItem('d', 'Delta', { romance: 1 }, { fire: 4.5, water: 4 }),
    makeItem('e', 'Echo', { romance: 0.9, comedy: 0.1 }, { fire: 4, water: 4 }),
    makeItem('f', 'Foxtrot', { romance: 0.95, comedy: 0.05 }, { fire: 4, water: 4.5 }),
    makeItem('g', 'Golf', { crime: 0.5, romance: 0.5 }),
    makeItem('h', 'Hotel', { crime: 0.3, drama: 0.3, comedy: 0.4 }),
  ];
  const forward = rankDeterministicLanes({ items, as_of: AS_OF });
  const reversed = rankDeterministicLanes({ items: [...items].reverse(), as_of: AS_OF });
  const shuffled = [items[4]!, items[0]!, items[7]!, items[2]!, items[5]!, items[1]!, items[6]!, items[3]!];
  const shuffledResult = rankDeterministicLanes({ items: shuffled, as_of: AS_OF });
  assert.deepEqual(forward.seeds, reversed.seeds);
  assert.deepEqual(forward.seeds, shuffledResult.seeds);
  const canonical = (result: ReturnType<typeof rankDeterministicLanes>) =>
    result.ranked.map((entry) => `${entry.lane}:${entry.identity}:${entry.score.toFixed(6)}`);
  assert.deepEqual(canonical(forward), canonical(reversed));
  assert.deepEqual(canonical(forward), canonical(shuffledResult));
});

// -------------------------------------------------------------------------
// Legacy contract retained
// -------------------------------------------------------------------------

test('rank collapses to zero lanes without any positive evidence', () => {
  const result = rankDeterministicLanes({
    items: [
      makeItem('a', 'Alpha', { crime: 1 }, { fire: 2, water: 2 }),
      makeItem('b', 'Beta', { drama: 1 }, { fire: 1.5, water: 1.5 }),
    ],
    as_of: AS_OF,
  });
  assert.equal(result.lanes, 0);
  assert.equal(result.slate.length, 0);
  assert.ok(result.decisions.includes('no_positive_evidence'));
  assert.equal(result.ranked.length, 2, 'ranked must still cover the universe with lane=-1');
  for (const entry of result.ranked) assert.equal(entry.lane, -1);
});

test('rank honors exact exclusions and reports complete accounting', () => {
  const items: DeterministicLaneItem[] = [
    makeItem('a', 'Alpha', { crime: 1 }, { fire: 5, water: 4 }),
    makeItem('a2', 'Alpha Two', { crime: 0.98, drama: 0.02 }, { fire: 4, water: 5 }),
    makeItem('b', 'Beta', { crime: 0.9, drama: 0.1 }),
    makeItem('c', 'Charlie', { crime: 0.85, drama: 0.15 }),
    makeItem('d', 'Delta', { crime: 0.8, drama: 0.2 }),
    makeItem('excluded', 'Excluded', { crime: 0.95, drama: 0.05 }),
  ];
  const result = rankDeterministicLanes({
    items, as_of: AS_OF, exclude: new Set<DeterministicLaneIdentity>(['movie:excluded']),
  });
  assert.equal(result.slate.some((entry) => entry.identity === 'movie:excluded'), false);
  assert.equal(result.reserve.some((entry) => entry.identity === 'movie:excluded'), false);
  assert.equal(result.ranked.some((entry) => entry.identity === 'movie:excluded'), false);
});

test('typed identity prevents movie/series id collisions', () => {
  const items: DeterministicLaneItem[] = [
    makeItem('shared-id', 'Movie Shared', { crime: 1 }, { fire: 5, water: 4 }),
    makeItem('shared-id', 'Series Shared', { procedural: 1 }, { type: 'series' }),
  ];
  const result = rankDeterministicLanes({ items, as_of: AS_OF, min_support_per_lane: 1 });
  const seriesIdentity: DeterministicLaneIdentity = 'series:shared-id';
  assert.equal(result.seeds.includes(seriesIdentity), false,
    'typed identity keeps movie ratings from leaking into series');
});

// Sanity: sparseCosineIdf zero-cases behave.
test('sparseCosineIdf returns 0 when inputs share no features', () => {
  const idf = new Map<string, number>([['a', 1], ['b', 1]]);
  const cosine = sparseCosineIdf(features({ a: 1 }), features({ b: 1 }), idf);
  assert.equal(cosine, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aiCatalogWeight,
  categoryWeight,
  exploreWeight,
  forYouRelevanceWeight,
  recencyWeight,
  relatedEvidenceQualifies,
  relatedScore,
  relatedWeight,
  weightedDeal,
} from './vod-browse-v3.js';

test('Browse v3 keeps every eligible discovery candidate at finite positive weight', () => {
  const sparseExplore = exploreWeight({});
  const weakestCategory = categoryWeight({
    sourcePosition: 0,
    themeConfidence: 0,
    tasteAffinity: 0,
    novelty: 0,
  });
  const weakestAi = aiCatalogWeight({ catalogRelevance: 0, tasteAffinity: 0 });
  for (const weight of [sparseExplore, weakestCategory, weakestAi]) {
    assert.ok(Number.isFinite(weight));
    assert.ok(weight > 0);
  }
  assert.ok(sparseExplore >= 0.6 && sparseExplore <= 1);
  assert.ok(weakestCategory >= 0.35 && weakestCategory <= 1);
});

test('For You relevance weights enforce the fit floor and calibrated 32x ceiling', () => {
  assert.equal(forYouRelevanceWeight({ rankScore: 2.49, fitFloor: 2.5, threadQ95: 5 }), 0);
  assert.equal(forYouRelevanceWeight({ rankScore: 2.5, fitFloor: 2.5, threadQ95: 5 }), 1);
  assert.equal(forYouRelevanceWeight({ rankScore: 5, fitFloor: 2.5, threadQ95: 5 }), 32);
  const middle = forYouRelevanceWeight({ rankScore: 3.75, fitFloor: 2.5, threadQ95: 5 });
  assert.equal(middle, 8.75);
});

test('deterministic weighted deal is stable, unique, epoch-sensitive, and does not mutate input', () => {
  const items = Array.from({ length: 80 }, (_, index) => ({
    type: 'movie',
    id: `title-${String(index).padStart(3, '0')}`,
    weight: 0.6 + index / 200,
  }));
  const original = structuredClone(items);
  const first = weightedDeal(items, 9, 'movies:deal:7');
  const replay = weightedDeal(items, 9, 'movies:deal:7');
  const next = weightedDeal(items, 9, 'movies:deal:8');
  assert.deepEqual(first, replay);
  assert.deepEqual(items, original);
  assert.equal(new Set(first.map((item) => item.id)).size, 9);
  assert.notDeepEqual(first.map((item) => item.id), next.map((item) => item.id));
});

test('bounded top-k dealer is order-identical to the full weighted permutation', () => {
  const items = Array.from({ length: 500 }, (_, index) => ({
    type: index % 2 === 0 ? 'movie' : 'series',
    id: `fixture-${String(index).padStart(4, '0')}`,
    weight: 0.35 + (index % 71) / 100,
  }));
  const seed = 'weighted-reference:17';
  const unit = (value: string): number => {
    let high = 0xdeadbeef ^ value.length;
    let low = 0x41c6ce57 ^ value.length;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      high = Math.imul(high ^ code, 2_654_435_761);
      low = Math.imul(low ^ code, 1_597_334_677);
    }
    high = Math.imul(high ^ (high >>> 16), 2_246_822_507)
      ^ Math.imul(low ^ (low >>> 13), 3_266_489_909);
    low = Math.imul(low ^ (low >>> 16), 2_246_822_507)
      ^ Math.imul(high ^ (high >>> 13), 3_266_489_909);
    return (((2_097_151 & low) * 0x1_0000_0000 + (high >>> 0)) + 1)
      / 0x20_0000_0000_0000;
  };
  const reference = [...items].map((item) => ({
    item,
    key: -Math.log(unit(`${seed}:${item.type}:${item.id}`)) / item.weight,
  })).sort((left, right) => (
    left.key - right.key
    || left.item.type.localeCompare(right.item.type)
    || left.item.id.localeCompare(right.item.id)
  )).slice(0, 64).map(({ item }) => item);
  assert.deepEqual(weightedDeal(items, 64, seed), reference);
});

test('utility recency weighting is bounded and rewards recent activity without excluding old rows', () => {
  const now = Date.UTC(2026, 7, 6);
  const recent = recencyWeight(now, 30, now);
  const old = recencyWeight(now - 365 * 24 * 60 * 60 * 1_000, 30, now);
  assert.equal(recent, 1);
  assert.ok(old >= 0.25 && old < recent);
});

test('Related requires independently scored families and gives semantics most of the mass', () => {
  const semantic = relatedScore({
    families: [
      { family: 'theme', score: 1, semantic: true },
      { family: 'tone', score: 0.8, semantic: true },
      { family: 'director', score: 0.5, semantic: false },
    ],
    householdAffinity: 0,
  });
  const factual = relatedScore({
    families: [
      { family: 'director', score: 1, semantic: false },
      { family: 'decade', score: 0.8, semantic: false },
    ],
    householdAffinity: 0,
  });
  assert.equal(semantic.sharedFamilies, 3);
  assert.equal(semantic.semanticFamilies, 2);
  assert.ok(semantic.score > factual.score);
  assert.equal(relatedWeight(0), 1);
  assert.equal(relatedWeight(1), 16);
});

test('Related admission rejects parent and facet coincidences but preserves rich and sparse contracts', () => {
  assert.equal(relatedEvidenceQualifies({
    anchorEnriched: true,
    shared: [
      { family: 'theme', nodeKey: 'theme:parent%3Dinner-life' },
      { family: 'facet.pace', nodeKey: 'facet.pace:pace' },
      { family: 'format', nodeKey: 'format:feature-film' },
      { family: 'narrative-structure', nodeKey: 'narrative-structure:linear' },
    ],
  }), false);
  assert.equal(relatedEvidenceQualifies({
    anchorEnriched: true,
    shared: [
      { family: 'genre-subgenre', nodeKey: 'genre-subgenre:crime' },
      { family: 'story-engine', nodeKey: 'story-engine:investigation' },
      { family: 'theme', nodeKey: 'theme:justice' },
    ],
  }), true);
  assert.equal(relatedEvidenceQualifies({
    anchorEnriched: false,
    shared: [
      { family: 'genre-subgenre', nodeKey: 'genre-subgenre:drama' },
      { family: 'format', nodeKey: 'format:feature-film' },
    ],
  }), true);
  assert.equal(relatedEvidenceQualifies({
    anchorEnriched: false,
    shared: [
      { family: 'genre-subgenre', nodeKey: 'genre-subgenre:drama' },
      { family: 'tone', nodeKey: 'tone:warm' },
    ],
  }), false);
  assert.equal(relatedEvidenceQualifies({
    anchorEnriched: true,
    shared: [
      { family: 'genre-subgenre', nodeKey: 'genre-subgenre:drama' },
      { family: 'character-dynamic', nodeKey: 'character-dynamic:ensemble' },
      { family: 'tone', nodeKey: 'tone:witty' },
      { family: 'compound', nodeKey: 'compound:genre%3Ddrama%26pace%3D3' },
    ],
  }), false);
});

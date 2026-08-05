import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoryDnaDocument } from './story-dna.js';
import { rankStoryGraphRecommendationsOffThread } from './story-graph-rank-worker-client.js';
import {
  STORY_GRAPH_EXPLICIT_SHARE,
  STORY_GRAPH_IMPLICIT_SHARE,
  VOD_STORY_GRAPH_MODEL_VERSION,
  buildStoryDealerCache,
  buildStoryTasteModel,
  dealStoryRecommendations,
  likelihoodMatchStandardDeviation,
  positiveRatingEvidence,
  rankStoryGraphRecommendations,
  scoreStoryGraphCandidate,
  selectStrongestFitPortfolio,
  storyDealerRankWeight,
  storyGraphMixtureLogRatio,
  storyGraphWeightedMeanAndStandardError,
  storyRatingAnchorStrength,
  type StoryGraphContentId,
  type StoryGraphExplicitRating,
  type StoryGraphRankInput,
  type StoryGraphScoredRecommendation,
  type StoryGraphTitle,
} from './story-graph-v1.js';

const NOW = 1_800_000_000_000;

type Flavor = 'action' | 'water' | 'comedy';

const FLAVORS = {
  action: {
    genre: 'action', engine: 'revenge', theme: 'justice', dynamic: 'lone-protagonist',
    tone: 'suspenseful', social: 'criminal-underworld', arc: 'triumphant',
    facets: { action: 4, tension: 4, spectacle: 4, tenderness: 0, sadness: 1, humor: 0 },
  },
  water: {
    genre: 'drama', engine: 'family-conflict', theme: 'family', dynamic: 'parent-child',
    tone: 'warm', social: 'domestic', arc: 'bittersweet',
    facets: { action: 0, tension: 1, spectacle: 0, tenderness: 4, sadness: 3, humor: 1 },
  },
  comedy: {
    genre: 'comedy', engine: 'workplace', theme: 'friendship', dynamic: 'team',
    tone: 'witty', social: 'workplace', arc: 'uplifting',
    facets: { action: 1, tension: 0, spectacle: 1, tenderness: 2, sadness: 0, humor: 4 },
  },
} as const;

function storyTitle(
  id: string,
  flavor: Flavor,
  options: { confidence?: number; type?: 'movie' | 'series' } = {},
): StoryGraphTitle {
  const selected = FLAVORS[flavor];
  const confidence = options.confidence ?? 1;
  const facets = {
    pace: flavor === 'action' ? 4 : flavor === 'water' ? 1 : 3,
    action: selected.facets.action,
    tension: selected.facets.tension,
    spectacle: selected.facets.spectacle,
    humor: selected.facets.humor,
    romance: flavor === 'water' ? 2 : 0,
    fear: flavor === 'action' ? 2 : 0,
    tenderness: selected.facets.tenderness,
    sadness: selected.facets.sadness,
    hope: flavor === 'water' ? 3 : 2,
    realism: flavor === 'action' ? 2 : 4,
    narrative_complexity: flavor === 'comedy' ? 1 : 3,
    moral_ambiguity: flavor === 'action' ? 3 : 1,
    violence: flavor === 'action' ? 4 : 0,
    family_accessibility: flavor === 'action' ? 0 : 4,
  };
  const type = options.type ?? 'movie';
  const document: StoryDnaDocument = {
    type,
    id,
    schema_version: 'story-dna-v1',
    ontology_version: 'story-dna-core-v1',
    teacher_role: 'content-only',
    model_version: 'story-test-model',
    prompt_version: 'story-dna-v1',
    input_hash: id.padEnd(64, 'a').slice(0, 64).replace(/[^a-f0-9]/g, 'a'),
    genre_subgenres: [selected.genre],
    format: type === 'movie' ? 'feature-film' : 'ongoing-series',
    story_engines: [selected.engine],
    themes: [selected.theme],
    character_dynamics: [selected.dynamic],
    tone: [selected.tone],
    setting_era: 'contemporary',
    geographic_scope: flavor === 'action' ? 'global' : 'city',
    social_settings: [selected.social],
    narrative_structures: [flavor === 'comedy' ? 'episodic' : 'linear'],
    ending_emotional_arc: selected.arc,
    facets,
    confidence: {
      overall: confidence,
      genre_subgenre: confidence,
      format: confidence,
      story_engine: confidence,
      themes: confidence,
      character_dynamics: confidence,
      tone: confidence,
      setting_era: confidence,
      geographic_scope: confidence,
      social_setting: confidence,
      narrative_structure: confidence,
      ending_emotional_arc: confidence,
      facets: confidence,
    },
    provenance: {
      teacher: 'llm-content-teacher',
      content_only: true,
      evidence_hash: 'b'.repeat(64),
      evidence_fields: ['title', 'synopsis', 'genres'],
      sources: ['test'],
    },
    selective_lookup: { requested: false, reasons: [], policy: 'structured-only', used: false },
  };
  return { type, id, title: `Title ${id}`, year: '2020', story_dna: document };
}

function uniformFacetTitle(id: string, value: number, confidence = 1): StoryGraphTitle {
  const title = storyTitle(id, 'action', { confidence });
  title.story_dna!.facets = Object.fromEntries(
    Object.keys(title.story_dna!.facets).map((facet) => [facet, value]),
  ) as StoryDnaDocument['facets'];
  return title;
}

function rating(id: string, fire: number, water: number): StoryGraphExplicitRating {
  return { type: 'movie', id, fire, water };
}

function identity(id: string): StoryGraphContentId {
  return `movie:${id}`;
}

test('positive rating propagation is quadratic above neutral two and never negative', () => {
  assert.equal(positiveRatingEvidence(0), 0);
  assert.equal(positiveRatingEvidence(0.5), 0);
  assert.equal(positiveRatingEvidence(1), 0);
  assert.equal(positiveRatingEvidence(1.5), 0);
  assert.equal(positiveRatingEvidence(2), 0);
  assert.ok(Math.abs(positiveRatingEvidence(2.5) - (0.5 / 3) ** 2) < 1e-12);
  assert.ok(Math.abs(positiveRatingEvidence(3.5) - 0.25) < 1e-12);
  assert.ok(Math.abs(positiveRatingEvidence(4.5) - (2.5 / 3) ** 2) < 1e-12);
  assert.equal(positiveRatingEvidence(5), 1);
  assert.equal(storyRatingAnchorStrength(5, 0), 0.75);
  assert.equal(storyRatingAnchorStrength(0, 5), 0.75);
  assert.equal(storyRatingAnchorStrength(5, 5), 1);
});

test('one strongest single-axis rating is one supported taste-thread unit', () => {
  for (const [axis, fire, water] of [
    ['fire', 5, 0],
    ['water', 0, 5],
  ] as const) {
    const documents = [
      storyTitle(`${axis}-anchor`, axis === 'fire' ? 'action' : 'water'),
      storyTitle(`${axis}-candidate`, axis === 'fire' ? 'action' : 'water'),
      storyTitle(`${axis}-background`, 'comedy'),
    ];
    const model = buildStoryTasteModel({
      documents,
      explicit_ratings: [rating(`${axis}-anchor`, fire, water)],
      as_of: NOW,
    });
    assert.equal(model.selected_k, 1);
    assert.ok(Math.abs(model.threads[0]!.effective_evidence_mass - 0.75) < 1e-12);
    if (axis === 'fire') {
      assert.ok(model.threads[0]!.fire_uplift > model.threads[0]!.water_uplift);
    } else {
      assert.ok(model.threads[0]!.water_uplift > model.threads[0]!.fire_uplift);
    }
  }
});

test('ratings at or below neutral two add no thematic evidence or related-title penalty', () => {
  const documents = [
    storyTitle('liked-1', 'action'), storyTitle('liked-2', 'action'),
    storyTitle('low', 'action'), storyTitle('candidate', 'action'), storyTitle('other', 'water'),
  ];
  const base = buildStoryTasteModel({
    documents,
    explicit_ratings: [rating('liked-1', 5, 0), rating('liked-2', 5, 0)],
    as_of: NOW,
  });
  const withLow = buildStoryTasteModel({
    documents,
    explicit_ratings: [
      rating('liked-1', 5, 0), rating('liked-2', 5, 0), rating('low', 0, 2),
    ],
    as_of: NOW,
  });
  assert.equal(withLow.diagnostics.ignored_low_ratings, 1);
  assert.deepEqual(
    scoreStoryGraphCandidate(withLow, documents[3]!),
    scoreStoryGraphCandidate(base, documents[3]!),
  );
});

test('three disjoint well-supported tastes remain separate and preserve axis character', () => {
  const documents = [
    storyTitle('action-1', 'action'), storyTitle('action-2', 'action'), storyTitle('action-3', 'action'), storyTitle('action-4', 'action'),
    storyTitle('water-1', 'water'), storyTitle('water-2', 'water'), storyTitle('water-3', 'water'), storyTitle('water-4', 'water'),
    storyTitle('comedy-1', 'comedy'), storyTitle('comedy-2', 'comedy'), storyTitle('comedy-3', 'comedy'), storyTitle('comedy-4', 'comedy'),
    storyTitle('action-candidate', 'action'), storyTitle('water-candidate', 'water'),
    storyTitle('comedy-candidate', 'comedy'),
  ];
  const model = buildStoryTasteModel({
    documents,
    explicit_ratings: [
      rating('action-1', 5, 0), rating('action-2', 5, 0), rating('action-3', 5, 0), rating('action-4', 5, 0),
      rating('water-1', 0, 5), rating('water-2', 0, 5), rating('water-3', 0, 5), rating('water-4', 0, 5),
      rating('comedy-1', 5, 5), rating('comedy-2', 5, 5), rating('comedy-3', 5, 5), rating('comedy-4', 5, 5),
    ],
    as_of: NOW,
  });
  assert.equal(model.selected_k, 3, JSON.stringify(model.loao));
  assert.ok(model.threads.every((thread) => thread.effective_evidence_mass >= 1));
  const action = scoreStoryGraphCandidate(model, documents[12]!);
  const water = scoreStoryGraphCandidate(model, documents[13]!);
  const comedy = scoreStoryGraphCandidate(model, documents[14]!);
  assert.ok(action.predicted_fire > action.predicted_water);
  assert.ok(water.predicted_water > water.predicted_fire);
  assert.ok(comedy.predicted_fire > 3 && comedy.predicted_water > 3);
  assert.ok(Math.abs(comedy.predicted_fire - comedy.predicted_water) < 1e-9);
  assert.equal(new Set([action.best_thread_id, water.best_thread_id, comedy.best_thread_id]).size, 3);
});

test('explicit evidence owns 85% and conflicting implicit evidence is capped at 15%', () => {
  assert.equal(STORY_GRAPH_EXPLICIT_SHARE, 0.85);
  assert.equal(STORY_GRAPH_IMPLICIT_SHARE, 0.15);
  const documents = [
    storyTitle('explicit-1', 'action'), storyTitle('explicit-2', 'action'),
    storyTitle('implicit-1', 'water'), storyTitle('implicit-2', 'water'),
    storyTitle('action-candidate', 'action'), storyTitle('water-candidate', 'water'),
  ];
  const model = buildStoryTasteModel({
    documents,
    explicit_ratings: [rating('explicit-1', 5, 0), rating('explicit-2', 5, 0)],
    implicit_signals: [
      { type: 'movie', id: 'implicit-1', kind: 'completion', occurred_at: NOW },
      { type: 'movie', id: 'implicit-2', kind: 'completion', occurred_at: NOW },
    ],
    as_of: NOW,
  });
  const explicitCandidate = scoreStoryGraphCandidate(model, documents[4]!);
  const implicitCandidate = scoreStoryGraphCandidate(model, documents[5]!);
  assert.ok(explicitCandidate.affinity > implicitCandidate.affinity);
  assert.ok(explicitCandidate.explicit_support > 0);
  assert.ok(implicitCandidate.implicit_support > 0);
});

test('categorical posterior node masses equal their family evidence mass', () => {
  const documents = [storyTitle('mass-1', 'action'), storyTitle('mass-2', 'action')];
  const model = buildStoryTasteModel({
    documents,
    explicit_ratings: [rating('mass-1', 5, 5), rating('mass-2', 5, 5)],
    as_of: NOW,
  });
  assert.equal(model.threads.length, 1);
  const families = model.threads[0]!.explicit_profile.families;
  for (const family of Object.values(families)) {
    if (family.ordinal) continue;
    const nodeMass = Object.values(family.node_mass).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(nodeMass - family.evidence_mass) < 1e-10);
  }
});

test('ordered multi-value evidence divides family mass by salience without duplication', () => {
  const first = storyTitle('salient-1', 'action');
  const second = storyTitle('salient-2', 'action');
  first.story_dna!.themes = ['justice', 'duty'];
  second.story_dna!.themes = ['justice', 'duty'];
  const model = buildStoryTasteModel({
    documents: [first, second],
    explicit_ratings: [rating(first.id, 5, 5), rating(second.id, 5, 5)],
    as_of: NOW,
  });
  const theme = model.threads[0]!.explicit_profile.families.theme!;
  assert.ok(Math.abs(
    Object.values(theme.node_mass).reduce((sum, value) => sum + value, 0)
      - theme.evidence_mass,
  ) < 1e-10);
  assert.ok(Math.abs(
    theme.node_mass['theme:justice']! / theme.node_mass['theme:duty']! - 2,
  ) < 1e-10);
});

test('missing metadata families stay in the fixed verified-corpus likelihood denominator', () => {
  const withLanguage = (title: StoryGraphTitle, language: string): StoryGraphTitle => ({
    ...title,
    edges: [{
      family: 'language', node_key: `language:${language}`, intensity: 1,
      confidence: 1, ordinal: false, source: 'metadata',
    }],
  });
  const anchors = [
    withLanguage(storyTitle('language-anchor-1', 'action'), 'english'),
    withLanguage(storyTitle('language-anchor-2', 'action'), 'english'),
  ];
  const present = withLanguage(storyTitle('language-present', 'action'), 'english');
  const missing = storyTitle('language-missing', 'action');
  const background = [
    ...anchors,
    present,
    missing,
    withLanguage(storyTitle('language-hindi-1', 'water'), 'hindi'),
    withLanguage(storyTitle('language-hindi-2', 'water'), 'hindi'),
  ];
  const model = buildStoryTasteModel({
    documents: background,
    background_documents: background,
    explicit_ratings: anchors.map((anchor) => rating(anchor.id, 5, 5)),
    as_of: NOW,
  });
  assert.ok(model.background.families.language);
  const presentScore = scoreStoryGraphCandidate(model, present);
  const missingScore = scoreStoryGraphCandidate(model, missing);
  assert.ok(presentScore.explicit_support > missingScore.explicit_support);
  assert.ok(missingScore.posterior_standard_deviation >= presentScore.posterior_standard_deviation);
});

test('LOAO refits without empty held-seed components', () => {
  const documents = [
    storyTitle('loao-action', 'action'),
    storyTitle('loao-water', 'water'),
    storyTitle('loao-comedy', 'comedy'),
  ];
  const model = buildStoryTasteModel({
    documents,
    explicit_ratings: [
      rating('loao-action', 5, 5),
      rating('loao-water', 5, 5),
      rating('loao-comedy', 5, 5),
    ],
    as_of: NOW,
  });
  assert.equal(model.loao.length, 3);
  assert.ok(model.loao.every((row) => Number.isFinite(row.mean_log_likelihood)
    && Number.isFinite(row.standard_error)));
  const unsupportedK3 = model.loao.find((row) => row.k === 3)!;
  const supported = model.loao.filter((row) => row.k < 3);
  assert.ok(unsupportedK3.mean_log_likelihood <= Math.max(
    ...supported.map((row) => row.mean_log_likelihood),
  ));
});

test('mixture predictive integrates components and weighted statistics preserve evidence strength', () => {
  const mixture = storyGraphMixtureLogRatio([Math.log(4), 0], [0.25, 0.75]);
  assert.ok(Math.abs(mixture - Math.log(1.75)) < 1e-12);
  assert.ok(mixture > Math.max(Math.log(0.25) + Math.log(4), Math.log(0.75)));
  assert.equal(storyGraphMixtureLogRatio([100, 0], [0, 1]), 0);

  const weighted = storyGraphWeightedMeanAndStandardError([10, 0], [1, 0.1]);
  assert.ok(Math.abs(weighted.mean - (10 / 1.1)) < 1e-12);
  assert.ok(weighted.mean > 9, 'a weak held anchor must not count like a full-strength anchor');
  assert.ok(Number.isFinite(weighted.standardError) && weighted.standardError > 0);
});

test('soft mixture fitting is byte-stable across input order and replay', () => {
  const documents = [
    storyTitle('det-action-1', 'action'), storyTitle('det-action-2', 'action'),
    storyTitle('det-water-1', 'water'), storyTitle('det-water-2', 'water'),
    storyTitle('det-comedy-1', 'comedy'), storyTitle('det-comedy-2', 'comedy'),
  ];
  const explicitRatings = [
    rating('det-action-1', 5, 0), rating('det-action-2', 5, 0),
    rating('det-water-1', 0, 5), rating('det-water-2', 0, 5),
    rating('det-comedy-1', 5, 5), rating('det-comedy-2', 5, 5),
  ];
  const first = buildStoryTasteModel({ documents, explicit_ratings: explicitRatings, as_of: NOW });
  const replay = buildStoryTasteModel({
    documents: [...documents].reverse(),
    explicit_ratings: [...explicitRatings].reverse(),
    as_of: NOW,
  });
  assert.deepEqual(replay, first);
  assert.ok(first.threads.every((thread) => thread.effective_evidence_mass >= 0.75));
});

test('support uncertainty uses the nonlinear positive-only posterior scale', () => {
  assert.equal(likelihoodMatchStandardDeviation(1, 0), 0);
  const uncertainAtBoundary = likelihoodMatchStandardDeviation(0, 1);
  const certainPositive = likelihoodMatchStandardDeviation(1, 0.1);
  const saturated = likelihoodMatchStandardDeviation(4, 1);
  assert.ok(uncertainAtBoundary > certainPositive);
  assert.ok(saturated < uncertainAtBoundary);
  assert.ok(uncertainAtBoundary > 0 && uncertainAtBoundary <= 0.5);
});

test('retained unplayable anchors teach taste but never enter verified background or candidates', () => {
  const anchors = [
    storyTitle('retained-anchor-1', 'action'),
    storyTitle('retained-anchor-2', 'action'),
  ];
  const verified = Array.from({ length: 12 }, (_, index) => storyTitle(
    `verified-${index}`,
    index % 2 === 0 ? 'action' : 'water',
  ));
  const result = rankStoryGraphRecommendations({
    algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
    documents: [...anchors, ...verified],
    background_ids: verified.map((title) => identity(title.id)),
    candidate_ids: verified.map((title) => identity(title.id)),
    explicit_ratings: anchors.map((anchor) => rating(anchor.id, 5, 0)),
    as_of: NOW,
  });
  assert.equal(result.ranked.length, verified.length);
  assert.equal(result.ranked.some((item) => anchors.some((anchor) => anchor.id === item.id)), false);
  assert.equal(result.selected_k, 1);
  assert.ok(result.ranked.find((item) => item.id === 'verified-0')!.predicted_fire > 2.5);
});

test('viewing evidence has a 180-day half-life while Saved remains durable', () => {
  const documents = [storyTitle('one', 'action'), storyTitle('two', 'action')];
  const fresh = buildStoryTasteModel({
    documents,
    explicit_ratings: [],
    implicit_signals: [{ type: 'movie', id: 'one', kind: 'completion', occurred_at: NOW }],
    as_of: NOW,
  });
  const aged = buildStoryTasteModel({
    documents,
    explicit_ratings: [],
    implicit_signals: [{
      type: 'movie', id: 'one', kind: 'completion',
      occurred_at: NOW - 180 * 24 * 60 * 60 * 1_000,
    }],
    as_of: NOW,
  });
  const saved = buildStoryTasteModel({
    documents,
    explicit_ratings: [],
    implicit_signals: [
      { type: 'movie', id: 'one', kind: 'saved', occurred_at: 1 },
      { type: 'movie', id: 'two', kind: 'saved', occurred_at: 1 },
    ],
    as_of: NOW,
  });
  assert.equal(fresh.diagnostics.total_implicit_mass, 1);
  assert.ok(Math.abs(aged.diagnostics.total_implicit_mass - 0.5) < 1e-12);
  assert.equal(saved.diagnostics.total_implicit_mass, 1.6);
  assert.equal(fresh.selected_k, 1);
  assert.equal(aged.selected_k, 0);
  assert.equal(saved.selected_k, 1);
});

function syntheticScore(id: string, thread: string, score: number): StoryGraphScoredRecommendation {
  return {
    type: 'movie', id, title: id, year: null,
    predicted_fire: 4, predicted_water: 4, holistic: 4,
    affinity: score, posterior_standard_deviation: 0.2,
    rank_score: score - 0.1, best_thread_id: thread,
    explicit_support: 0.8, implicit_support: 0,
    feature_confidence: 1, thread_matches: [],
  };
}

test('strongest-fit portfolio allocates 2/2/2, 3/3, or all six', () => {
  const three = ['a', 'b', 'c'].flatMap((thread, threadIndex) => (
    Array.from({ length: 6 }, (_, index) => syntheticScore(
      `${thread}-${index}`,
      thread,
      5 - threadIndex * 0.1 - index * 0.01,
    ))
  ));
  const threeResult = selectStrongestFitPortfolio(three, ['a', 'b', 'c']);
  assert.deepEqual(
    Object.fromEntries(['a', 'b', 'c'].map((thread) => [
      thread, threeResult.filter((item) => item.best_thread_id === thread).length,
    ])),
    { a: 2, b: 2, c: 2 },
  );
  const twoResult = selectStrongestFitPortfolio(three.filter((item) => item.best_thread_id !== 'c'), ['a', 'b']);
  assert.equal(twoResult.filter((item) => item.best_thread_id === 'a').length, 3);
  assert.equal(twoResult.filter((item) => item.best_thread_id === 'b').length, 3);
  const oneResult = selectStrongestFitPortfolio(three.filter((item) => item.best_thread_id === 'a'), ['a']);
  assert.equal(oneResult.length, 6);
  assert.ok(oneResult.every((item) => item.best_thread_id === 'a'));
});

test('dealer caches the full pool and deals deterministic rank^-1.5 portfolios without replacement', () => {
  const ranked = Array.from({ length: 30 }, (_, index) => syntheticScore(
    `item-${index}`,
    ['a', 'b', 'c'][index % 3]!,
    5 - index * 0.01,
  ));
  const cache = buildStoryDealerCache(ranked, ['a', 'b', 'c']);
  assert.equal(cache.items.length, 30);
  assert.equal(cache.items[0]!.dealer_weight, 1);
  // Sampling ranks are dense inside each thread. A globally interleaved
  // thread cannot be penalized merely because another taste ranked first.
  assert.equal(cache.items[1]!.dealer_weight, 1);
  assert.equal(cache.items[3]!.dealer_weight, 2 ** -1.5);
  assert.equal(storyDealerRankWeight(10), 10 ** -1.5);
  const first = dealStoryRecommendations(cache, { seed: 'same-seed' });
  const second = dealStoryRecommendations(cache, { seed: 'same-seed' });
  assert.deepEqual(first, second);
  assert.equal(first.length, 6);
  assert.equal(new Set(first.map((item) => identity(item.id))).size, 6);
  assert.deepEqual(
    Object.fromEntries(['a', 'b', 'c'].map((thread) => [
      thread, first.filter((item) => item.best_thread_id === thread).length,
    ])),
    { a: 2, b: 2, c: 2 },
  );
  const excluded = first.slice(0, 2).map((item) => identity(item.id));
  const next = dealStoryRecommendations(cache, { seed: 'next', exclude_ids: excluded });
  assert.equal(next.some((item) => excluded.includes(identity(item.id))), false);
});

test('rank output covers the entire requested corpus and uses the exact risk formula', () => {
  const documents = Array.from({ length: 250 }, (_, index) => storyTitle(
    `title-${String(index).padStart(3, '0')}`,
    (['action', 'water', 'comedy'] as const)[index % 3]!,
  ));
  const result = rankStoryGraphRecommendations({
    algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
    documents,
    explicit_ratings: [rating('title-000', 5, 0), rating('title-003', 5, 0)],
    as_of: NOW,
  });
  assert.equal(result.ranked.length, 250);
  assert.equal(result.dealer_cache.items.length, 250);
  assert.equal(result.portfolio.length, 6);
  for (const item of result.ranked) {
    assert.equal(item.rank_score, item.affinity - 0.5 * item.posterior_standard_deviation);
  }
});

test('v2 off-thread ranking is byte-for-byte equal to the pure ranker', async () => {
  const input: StoryGraphRankInput = {
    algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
    documents: Array.from({ length: 24 }, (_, index) => storyTitle(
      `worker-${String(index).padStart(2, '0')}`,
      (['action', 'water', 'comedy'] as const)[index % 3]!,
    )),
    explicit_ratings: [rating('worker-00', 5, 0), rating('worker-03', 5, 0)],
    as_of: NOW,
  };
  assert.deepEqual(
    await rankStoryGraphRecommendationsOffThread(input),
    rankStoryGraphRecommendations(input),
  );
});

test('off-thread scorer checkpoints bounded pages without changing rank output', async () => {
  const previous = process.env.MANGO_VOD_RANK_PAGE_SIZE;
  process.env.MANGO_VOD_RANK_PAGE_SIZE = '32';
  const cursors: Array<[number, number]> = [];
  const input: StoryGraphRankInput = {
    algorithm: VOD_STORY_GRAPH_MODEL_VERSION,
    documents: Array.from({ length: 97 }, (_, index) => storyTitle(
      `paged-${String(index).padStart(3, '0')}`,
      (['action', 'water', 'comedy'] as const)[index % 3]!,
    )),
    explicit_ratings: [rating('paged-000', 5, 0), rating('paged-003', 5, 0)],
    as_of: NOW,
    on_page: (cursor, total) => { cursors.push([cursor, total]); },
  };
  try {
    const offThread = await rankStoryGraphRecommendationsOffThread(input);
    assert.deepEqual(offThread, rankStoryGraphRecommendations({ ...input, on_page: undefined }));
    assert.deepEqual(cursors, [[32, 97], [64, 97], [96, 97], [97, 97]]);
  } finally {
    if (previous === undefined) delete process.env.MANGO_VOD_RANK_PAGE_SIZE;
    else process.env.MANGO_VOD_RANK_PAGE_SIZE = previous;
  }
});

test('candidate confidence shrink increases uncertainty and lowers risk-adjusted rank', () => {
  const high = storyTitle('candidate-high', 'action', { confidence: 1 });
  const low = storyTitle('candidate-low', 'action', { confidence: 0.1 });
  const documents = [
    storyTitle('anchor-1', 'action'), storyTitle('anchor-2', 'action'),
    high, low, storyTitle('background', 'water'),
  ];
  const model = buildStoryTasteModel({
    documents,
    explicit_ratings: [rating('anchor-1', 5, 0), rating('anchor-2', 5, 0)],
    as_of: NOW,
  });
  const highScore = scoreStoryGraphCandidate(model, high);
  const lowScore = scoreStoryGraphCandidate(model, low);
  assert.ok(highScore.posterior_standard_deviation < lowScore.posterior_standard_deviation);
  assert.ok(highScore.rank_score > lowScore.rank_score);
});

test('zero-confidence ordinal evidence is corpus-neutral and cannot manufacture certainty', () => {
  const anchors = [uniformFacetTitle('confidence-anchor-1', 2), uniformFacetTitle('confidence-anchor-2', 2)];
  const zeroConfidenceAnchors = [
    uniformFacetTitle('confidence-zero-anchor-1', 2, 0),
    uniformFacetTitle('confidence-zero-anchor-2', 2, 0),
  ];
  const candidate = uniformFacetTitle('confidence-zero-candidate', 2, 0);
  const documents = [
    ...anchors,
    ...zeroConfidenceAnchors,
    candidate,
    ...Array.from({ length: 4 }, (_, index) => uniformFacetTitle(`confidence-low-${index}`, 0)),
    ...Array.from({ length: 4 }, (_, index) => uniformFacetTitle(`confidence-high-${index}`, 4)),
  ];
  const baseline = buildStoryTasteModel({
    documents,
    explicit_ratings: anchors.map((anchor) => rating(anchor.id, 5, 0)),
    as_of: NOW,
  });
  const withZeroConfidenceTraining = buildStoryTasteModel({
    documents,
    explicit_ratings: [
      ...anchors.map((anchor) => rating(anchor.id, 5, 0)),
      ...zeroConfidenceAnchors.map((anchor) => rating(anchor.id, 5, 0)),
    ],
    as_of: NOW,
  });
  const neutral = scoreStoryGraphCandidate(baseline, candidate);
  assert.equal(neutral.feature_confidence, 0);
  assert.equal(neutral.explicit_support, 0);
  assert.equal(neutral.implicit_support, 0);
  assert.equal(neutral.affinity, 2);
  assert.equal(neutral.predicted_fire, 2);
  assert.equal(neutral.predicted_water, 2);
  assert.ok(neutral.posterior_standard_deviation > 0);

  const baselineCertainCandidate = scoreStoryGraphCandidate(
    baseline,
    uniformFacetTitle('confidence-certain-candidate', 2),
  );
  const withZeroCertainCandidate = scoreStoryGraphCandidate(
    withZeroConfidenceTraining,
    uniformFacetTitle('confidence-certain-candidate', 2),
  );
  assert.ok(Math.abs(
    baselineCertainCandidate.posterior_standard_deviation
      - withZeroCertainCandidate.posterior_standard_deviation,
  ) < 1e-9, 'zero-confidence training profiles must not reduce posterior uncertainty');
});

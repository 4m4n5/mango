import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORY_DNA_ONTOLOGY_VERSION,
  STORY_DNA_PROMPT_VERSION,
  STORY_DNA_SCHEMA_VERSION,
  storyDnaEvidenceFields,
  storyDnaEvidenceHash,
  storyDnaInputHash,
  storyDnaRequestItem,
  type StoryDnaDocument,
  type StoryDnaInput,
} from './story-dna.js';
import {
  compileContentProfileV2,
  contentProfileIsServingEligible,
  contentProfileStoryGraphTitle,
  contentSemanticEvidenceHash,
} from './content-profile-v2.js';
import { rankStoryGraphRecommendations } from './story-graph-v1.js';

function input(overrides: Partial<StoryDnaInput> = {}): StoryDnaInput {
  return {
    type: 'movie', id: 'tt100', title: 'The Long Night', year: '2022',
    synopsis: 'A detective investigation tests family bonds in a gritty city.',
    genres: ['Crime', 'Drama'], keywords: ['murder investigation'],
    languages: ['English'], countries: ['India'], runtime_minutes: 112,
    format: 'feature-film', cast: ['Actor One'], directors: ['Director One'],
    writers: ['Writer One'], awards_certification: ['PG-13'],
    external_ids: { imdb: 'tt100', tmdb: '100' },
    source: 'addon-a', retrieved_at: 100, field_provenance: { genres: ['addon-a'] },
    ...overrides,
  };
}

function teacherDocument(value: StoryDnaInput): StoryDnaDocument {
  const request = storyDnaRequestItem(value);
  return {
    type: value.type, id: value.id, schema_version: STORY_DNA_SCHEMA_VERSION,
    ontology_version: STORY_DNA_ONTOLOGY_VERSION, teacher_role: 'content-only',
    model_version: 'teacher-a', prompt_version: STORY_DNA_PROMPT_VERSION,
    input_hash: storyDnaInputHash(value), genre_subgenres: ['crime'],
    format: 'feature-film', story_engines: ['investigation'], themes: ['family'],
    character_dynamics: ['none'], tone: ['gritty'], setting_era: 'contemporary',
    geographic_scope: 'city', social_settings: ['urban-community'],
    narrative_structures: ['linear'], ending_emotional_arc: 'none',
    facets: {
      pace: 2, action: 1, tension: 3, spectacle: 1, humor: 0, romance: 0,
      fear: 1, tenderness: 2, sadness: 2, hope: 2, realism: 4,
      narrative_complexity: 2, moral_ambiguity: 3, violence: 2,
      family_accessibility: 2,
    },
    confidence: {
      overall: 0.9, genre_subgenre: 0.9, format: 0.9, story_engine: 0.9,
      themes: 0.9, character_dynamics: 0.9, tone: 0.9, setting_era: 0.9,
      geographic_scope: 0.9, social_setting: 0.9, narrative_structure: 0.9,
      ending_emotional_arc: 0.9, facets: 0.9,
    },
    provenance: {
      teacher: 'llm-content-teacher', content_only: true,
      evidence_hash: storyDnaEvidenceHash(value),
      evidence_fields: storyDnaEvidenceFields(value), sources: request.evidence.sources,
    },
    selective_lookup: request.selective_lookup,
  };
}

test('semantic evidence hash ignores operational retrieval and source churn', () => {
  const first = input();
  const second = input({
    source: 'addon-b', retrieved_at: 999,
    field_provenance: { genres: ['addon-b'], synopsis: ['addon-c'] },
  });
  assert.equal(contentSemanticEvidenceHash(first), contentSemanticEvidenceHash(second));
  assert.notEqual(contentSemanticEvidenceHash(first), contentSemanticEvidenceHash(input({
    synopsis: 'A different story about a comic workplace rivalry.',
  })));
});

test('deterministic factual profile is serving eligible without StoryDNA', () => {
  const profile = compileContentProfileV2(input());
  assert.equal(profile.profile_state, 'base');
  assert.equal(profile.teacher_document_hash, null);
  assert.equal(contentProfileIsServingEligible(profile), true);
  assert.ok(profile.edges.some((item) => item.node_key === 'story-engine:investigation'));
  assert.ok(profile.edges.some((item) => item.node_key === 'theme:family'));
  assert.ok(profile.edges.every((item) => !item.node_key.includes('popular')));
});

test('identity-only profile remains sparse and cannot serve', () => {
  const profile = compileContentProfileV2(input({
    synopsis: null, genres: [], keywords: [], languages: [], countries: [],
    runtime_minutes: null, cast: [], directors: [], writers: [],
    awards_certification: [], format: null,
  }));
  assert.equal(profile.profile_state, 'sparse_unresolved');
  assert.equal(contentProfileIsServingEligible(profile), false);
});

test('teacher overlay preserves known absence without inventing an edge', () => {
  const value = input();
  const profile = compileContentProfileV2(value, { teacher_document: teacherDocument(value) });
  assert.equal(profile.profile_state, 'enriched');
  assert.equal(profile.family_coverage['character-dynamic'].state, 'known_absent');
  assert.equal(profile.family_coverage['ending-emotional-arc'].state, 'known_absent');
  assert.ok(!profile.edges.some((item) => item.node_key.endsWith(':none')));
  assert.equal(profile.family_coverage['facet.humor'].state, 'observed');
  assert.equal(profile.edges.find((item) => item.family === 'facet.humor')?.intensity, 0);
});

test('exact facts win single-choice conflicts and awards never become quality edges', () => {
  const value = input({ awards_certification: ['Won 5 Academy Awards', 'R'] });
  const document = teacherDocument(value);
  document.format = 'short-film';
  const profile = compileContentProfileV2(value, { teacher_document: document });
  assert.deepEqual(
    profile.edges.filter((item) => item.family === 'format').map((item) => item.node_key),
    ['format:feature-film'],
  );
  assert.ok(profile.edges.some((item) => item.node_key === 'certification:r'));
  assert.ok(!profile.edges.some((item) => item.node_key.includes('academy-awards')));
});

test('progressive titles rank without a strict StoryDNA document', () => {
  const anchor = compileContentProfileV2(input({ id: 'anchor' }));
  const candidate = compileContentProfileV2(input({ id: 'candidate' }));
  const result = rankStoryGraphRecommendations({
    algorithm: 'vod-story-graph-v1',
    documents: [contentProfileStoryGraphTitle(anchor), contentProfileStoryGraphTitle(candidate)],
    background_ids: ['movie:anchor', 'movie:candidate'],
    candidate_ids: ['movie:candidate'],
    explicit_ratings: [{ type: 'movie', id: 'anchor', fire: 5, water: 4.5 }],
    as_of: 1,
  });
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0]?.id, 'candidate');
});

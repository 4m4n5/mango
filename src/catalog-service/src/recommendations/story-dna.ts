import { createHash } from 'node:crypto';
import type { RatingContentType } from '../library/ratings.js';

export const STORY_DNA_SCHEMA_VERSION = 'story-dna-v1' as const;
export const STORY_DNA_ONTOLOGY_VERSION = 'story-dna-core-v1' as const;
export const STORY_DNA_PROMPT_VERSION = 'story-dna-v1' as const;

export const STORY_DNA_GENRE_SUBGENRES = [
  'action', 'adventure', 'animation', 'biography', 'comedy', 'crime',
  'documentary', 'drama', 'family', 'fantasy', 'history', 'horror', 'music',
  'musical', 'mystery', 'reality', 'romance', 'sci-fi', 'sport', 'talk',
  'thriller', 'war', 'western', 'none',
] as const;

export const STORY_DNA_FORMATS = [
  'feature-film', 'short-film', 'documentary-feature', 'special', 'miniseries',
  'limited-series', 'ongoing-series', 'anthology-series', 'documentary-series',
  'reality-series', 'talk-series', 'none',
] as const;

export const STORY_DNA_STORY_ENGINES = [
  'investigation', 'quest', 'survival', 'rivalry', 'heist', 'revenge',
  'romance', 'family-conflict', 'coming-of-age', 'rise-and-fall',
  'transformation', 'workplace', 'political-struggle', 'social-issue',
  'friendship', 'slice-of-life', 'procedural', 'anthology', 'biography', 'none',
] as const;

export const STORY_DNA_THEMES = [
  'family', 'belonging', 'love', 'friendship', 'identity', 'ambition', 'power',
  'justice', 'duty', 'freedom', 'faith', 'grief', 'redemption', 'class',
  'community', 'survival', 'morality', 'obsession', 'legacy', 'prejudice',
  'nature', 'technology', 'none',
] as const;

export const STORY_DNA_CHARACTER_DYNAMICS = [
  'lone-protagonist', 'ensemble', 'found-family', 'parent-child', 'siblings',
  'romantic-pair', 'rivals', 'mentor-student', 'partners', 'team',
  'antihero-society', 'none',
] as const;

export const STORY_DNA_TONES = [
  'warm', 'hopeful', 'playful', 'witty', 'absurd', 'romantic', 'earnest',
  'contemplative', 'melancholic', 'dark', 'gritty', 'suspenseful',
  'frightening', 'cynical', 'triumphant', 'none',
] as const;

export const STORY_DNA_SETTING_ERAS = [
  'ancient', 'medieval', 'early-modern', 'nineteenth-century',
  'early-twentieth-century', 'mid-twentieth-century',
  'late-twentieth-century', 'contemporary', 'near-future', 'far-future',
  'timeless', 'mixed', 'none',
] as const;

export const STORY_DNA_GEOGRAPHIC_SCOPES = [
  'single-location', 'neighborhood', 'city', 'regional', 'national', 'global',
  'cosmic', 'virtual', 'mixed', 'none',
] as const;

export const STORY_DNA_SOCIAL_SETTINGS = [
  'domestic', 'school', 'workplace', 'military', 'political',
  'criminal-underworld', 'wealth-elite', 'working-class', 'rural-community',
  'urban-community', 'religious', 'sports', 'entertainment-industry',
  'scientific', 'wilderness', 'none',
] as const;

export const STORY_DNA_NARRATIVE_STRUCTURES = [
  'linear', 'nonlinear', 'episodic', 'serialized', 'anthology', 'procedural',
  'multiple-timelines', 'framed', 'unreliable-narrator', 'none',
] as const;

export const STORY_DNA_ENDING_EMOTIONAL_ARCS = [
  'uplifting', 'bittersweet', 'tragic', 'ambiguous', 'redemptive', 'triumphant',
  'downbeat', 'cyclical', 'open-ended', 'none',
] as const;

export const STORY_DNA_FACET_KEYS = [
  'pace', 'action', 'tension', 'spectacle', 'humor', 'romance', 'fear',
  'tenderness', 'sadness', 'hope', 'realism', 'narrative_complexity',
  'moral_ambiguity', 'violence', 'family_accessibility',
] as const;

export const STORY_DNA_CONFIDENCE_KEYS = [
  'overall', 'genre_subgenre', 'format', 'story_engine', 'themes',
  'character_dynamics', 'tone', 'setting_era', 'geographic_scope',
  'social_setting', 'narrative_structure', 'ending_emotional_arc', 'facets',
] as const;

export const STORY_DNA_LOOKUP_REASONS = [
  'identity-ambiguity', 'short-synopsis', 'missing-genres',
  'sparse-catalog-evidence',
] as const;

export const STORY_DNA_EVIDENCE_FIELDS = [
  'title', 'year', 'synopsis', 'genres', 'keywords', 'languages', 'countries',
  'runtime-minutes', 'release-state', 'format', 'cast', 'characters',
  'directors', 'writers', 'awards-certification', 'external-ids',
  'curated-pool-memberships', 'source', 'retrieved-at',
  'field-provenance',
] as const;

type ValueOf<T extends readonly string[]> = T[number];
export type StoryDnaLookupReason = ValueOf<typeof STORY_DNA_LOOKUP_REASONS>;
export type StoryDnaEvidenceField = ValueOf<typeof STORY_DNA_EVIDENCE_FIELDS>;
export type StoryDnaFacetKey = ValueOf<typeof STORY_DNA_FACET_KEYS>;
export type StoryDnaConfidenceKey = ValueOf<typeof STORY_DNA_CONFIDENCE_KEYS>;

export type StoryDnaInput = {
  type: RatingContentType;
  id: string;
  title: string;
  year?: string | number | null;
  description?: string | null;
  synopsis?: string | null;
  genres?: string[];
  keywords?: string[];
  languages?: string[];
  countries?: string[];
  runtime_minutes?: number | null;
  release_state?: string | null;
  format?: string | null;
  cast?: string[];
  characters?: string[];
  directors?: string[];
  writers?: string[];
  awards_certification?: string[];
  external_ids?: Record<string, string | number | null | undefined>;
  curated_pool_memberships?: string[];
  source?: string | null;
  retrieved_at?: string | number | null;
  evidence_sources?: string[];
  /** Optional per-field structured-provider provenance retained in canonical evidence. */
  field_provenance?: Record<string, string[]>;
  lookup_reasons?: StoryDnaLookupReason[];
  /** True only when the caller already performed the approved structured lookup. */
  lookup_used?: boolean;
  /** Catalog memberships only; normalized as curated-pool evidence. */
  rail_ids?: string[];
};

export type StoryDnaEvidence = {
  synopsis: string | null;
  genres: string[];
  keywords: string[];
  languages: string[];
  countries: string[];
  runtime_minutes: number | null;
  release_state: string | null;
  format: string | null;
  cast: string[];
  characters: string[];
  directors: string[];
  writers: string[];
  awards_certification: string[];
  external_ids: Record<string, string>;
  curated_pool_memberships: string[];
  sources: string[];
  retrieved_at: string | null;
  field_provenance: Record<string, string[]>;
};

export type StoryDnaSelectiveLookup = {
  requested: boolean;
  reasons: StoryDnaLookupReason[];
  policy: 'structured-only';
  used: boolean;
};

export type StoryDnaRequestItem = {
  type: RatingContentType;
  id: string;
  title: string;
  year: string | null;
  evidence: StoryDnaEvidence;
  selective_lookup: StoryDnaSelectiveLookup;
};

export type StoryDnaFacets = Record<StoryDnaFacetKey, number>;
export type StoryDnaFamilyConfidence = Record<StoryDnaConfidenceKey, number>;

export type StoryDnaDocument = {
  type: RatingContentType;
  id: string;
  schema_version: typeof STORY_DNA_SCHEMA_VERSION;
  ontology_version: typeof STORY_DNA_ONTOLOGY_VERSION;
  teacher_role: 'content-only';
  model_version: string;
  prompt_version: typeof STORY_DNA_PROMPT_VERSION;
  input_hash: string;
  genre_subgenres: Array<ValueOf<typeof STORY_DNA_GENRE_SUBGENRES>>;
  format: ValueOf<typeof STORY_DNA_FORMATS>;
  story_engines: Array<ValueOf<typeof STORY_DNA_STORY_ENGINES>>;
  themes: Array<ValueOf<typeof STORY_DNA_THEMES>>;
  character_dynamics: Array<ValueOf<typeof STORY_DNA_CHARACTER_DYNAMICS>>;
  tone: Array<ValueOf<typeof STORY_DNA_TONES>>;
  setting_era: ValueOf<typeof STORY_DNA_SETTING_ERAS>;
  geographic_scope: ValueOf<typeof STORY_DNA_GEOGRAPHIC_SCOPES>;
  social_settings: Array<ValueOf<typeof STORY_DNA_SOCIAL_SETTINGS>>;
  narrative_structures: Array<ValueOf<typeof STORY_DNA_NARRATIVE_STRUCTURES>>;
  ending_emotional_arc: ValueOf<typeof STORY_DNA_ENDING_EMOTIONAL_ARCS>;
  facets: StoryDnaFacets;
  confidence: StoryDnaFamilyConfidence;
  provenance: {
    teacher: 'llm-content-teacher';
    content_only: true;
    evidence_hash: string;
    evidence_fields: StoryDnaEvidenceField[];
    sources: string[];
  };
  selective_lookup: StoryDnaSelectiveLookup;
};

const STORY_DNA_DOCUMENT_KEYS = [
  'type', 'id', 'schema_version', 'ontology_version', 'teacher_role',
  'model_version', 'prompt_version', 'input_hash', 'genre_subgenres', 'format',
  'story_engines', 'themes', 'character_dynamics', 'tone', 'setting_era',
  'geographic_scope', 'social_settings', 'narrative_structures',
  'ending_emotional_arc', 'facets', 'confidence', 'provenance',
  'selective_lookup',
] as const;

const enumArraySchema = (values: readonly string[], maxItems: number) => ({
  type: 'array', minItems: 1, maxItems, uniqueItems: true,
  items: { type: 'string', enum: values },
});

const unitSchema = { type: 'number', minimum: 0, maximum: 1 } as const;
const ordinalSchema = { type: 'integer', minimum: 0, maximum: 4 } as const;

/** Closed output schema shared by runtime validation and teacher-contract tests. */
export const STORY_DNA_JSON_SCHEMA = {
  $id: STORY_DNA_SCHEMA_VERSION,
  type: 'object',
  additionalProperties: false,
  required: STORY_DNA_DOCUMENT_KEYS,
  properties: {
    type: { type: 'string', enum: ['movie', 'series'] },
    id: { type: 'string', minLength: 1, maxLength: 160 },
    schema_version: { const: STORY_DNA_SCHEMA_VERSION },
    ontology_version: { const: STORY_DNA_ONTOLOGY_VERSION },
    teacher_role: { const: 'content-only' },
    model_version: { type: 'string', minLength: 1 },
    prompt_version: { const: STORY_DNA_PROMPT_VERSION },
    input_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    genre_subgenres: enumArraySchema(STORY_DNA_GENRE_SUBGENRES, 4),
    format: { type: 'string', enum: STORY_DNA_FORMATS },
    story_engines: enumArraySchema(STORY_DNA_STORY_ENGINES, 4),
    themes: enumArraySchema(STORY_DNA_THEMES, 6),
    character_dynamics: enumArraySchema(STORY_DNA_CHARACTER_DYNAMICS, 4),
    tone: enumArraySchema(STORY_DNA_TONES, 4),
    setting_era: { type: 'string', enum: STORY_DNA_SETTING_ERAS },
    geographic_scope: { type: 'string', enum: STORY_DNA_GEOGRAPHIC_SCOPES },
    social_settings: enumArraySchema(STORY_DNA_SOCIAL_SETTINGS, 3),
    narrative_structures: enumArraySchema(STORY_DNA_NARRATIVE_STRUCTURES, 3),
    ending_emotional_arc: { type: 'string', enum: STORY_DNA_ENDING_EMOTIONAL_ARCS },
    facets: {
      type: 'object', additionalProperties: false, required: STORY_DNA_FACET_KEYS,
      properties: Object.fromEntries(STORY_DNA_FACET_KEYS.map((key) => [key, ordinalSchema])),
    },
    confidence: {
      type: 'object', additionalProperties: false, required: STORY_DNA_CONFIDENCE_KEYS,
      properties: Object.fromEntries(STORY_DNA_CONFIDENCE_KEYS.map((key) => [key, unitSchema])),
    },
    provenance: {
      type: 'object', additionalProperties: false,
      required: ['teacher', 'content_only', 'evidence_hash', 'evidence_fields', 'sources'],
      properties: {
        teacher: { const: 'llm-content-teacher' }, content_only: { const: true },
        evidence_hash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        evidence_fields: enumArraySchema(STORY_DNA_EVIDENCE_FIELDS, STORY_DNA_EVIDENCE_FIELDS.length),
        sources: {
          type: 'array', minItems: 1, maxItems: 8, uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
    },
    selective_lookup: {
      type: 'object', additionalProperties: false,
      required: ['requested', 'reasons', 'policy', 'used'],
      properties: {
        requested: { type: 'boolean' },
        reasons: {
          type: 'array', maxItems: STORY_DNA_LOOKUP_REASONS.length, uniqueItems: true,
          items: { type: 'string', enum: STORY_DNA_LOOKUP_REASONS },
        },
        policy: { const: 'structured-only' }, used: { type: 'boolean' },
      },
    },
  },
} as const;

function cleanText(value: unknown, limit: number, lower = false): string {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, limit);
  return lower ? cleaned.toLowerCase() : cleaned;
}

function cleanList(value: unknown, limit: number, itemLimit: number, lower = true): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const raw of value) {
    const item = cleanText(raw, itemLimit, lower);
    if (item && !output.includes(item)) output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function cleanExternalIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: Array<[string, string]> = [];
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = cleanText(rawKey, 40, true).replace(/[^a-z0-9._-]/g, '');
    const id = cleanText(rawValue, 160);
    if (key && id && !entries.some(([existing]) => existing === key)) entries.push([key, id]);
    if (entries.length >= 12) break;
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function cleanFieldProvenance(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Array<[string, string[]]> = [];
  for (const [rawField, rawSources] of Object.entries(value as Record<string, unknown>)) {
    const field = cleanText(rawField, 40, true).replace(/[^a-z0-9._-]/g, '');
    const sources = cleanList(
      Array.isArray(rawSources) ? rawSources : [rawSources],
      8,
      80,
    );
    if (field && sources.length > 0) output.push([field, sources]);
    if (output.length >= 24) break;
  }
  return Object.fromEntries(output.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizedRuntime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1_440 ? parsed : null;
}

function sortedObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortedObject(child)]));
  }
  return value;
}

export function stableStoryDnaJson(value: unknown): string {
  return JSON.stringify(sortedObject(value));
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStoryDnaJson(value)).digest('hex');
}

function substantiveEvidenceCount(evidence: StoryDnaEvidence): number {
  const values: unknown[] = [
    evidence.synopsis, evidence.genres, evidence.keywords, evidence.languages,
    evidence.countries, evidence.runtime_minutes, evidence.release_state,
    evidence.format, evidence.cast, evidence.characters, evidence.directors,
    evidence.writers, evidence.awards_certification, evidence.external_ids,
    evidence.curated_pool_memberships,
  ];
  return values.filter((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== null && value !== '';
  }).length;
}

function lookupMarker(
  input: StoryDnaInput,
  evidence: StoryDnaEvidence,
  year: string | null,
): StoryDnaSelectiveLookup {
  const reasons: StoryDnaLookupReason[] = [];
  if (!year && Object.keys(evidence.external_ids).length === 0) reasons.push('identity-ambiguity');
  if (!evidence.synopsis || evidence.synopsis.length < 120) reasons.push('short-synopsis');
  if (evidence.genres.length === 0) reasons.push('missing-genres');
  if (substantiveEvidenceCount(evidence) < 3) reasons.push('sparse-catalog-evidence');
  for (const reason of input.lookup_reasons ?? []) {
    if ((STORY_DNA_LOOKUP_REASONS as readonly string[]).includes(reason) && !reasons.includes(reason)) {
      reasons.push(reason);
    }
  }
  return {
    requested: reasons.length > 0,
    reasons,
    policy: 'structured-only',
    used: input.lookup_used === true && reasons.length > 0,
  };
}

export function storyDnaRequestItem(input: StoryDnaInput): StoryDnaRequestItem {
  const sources = cleanList(
    [input.source, ...(input.evidence_sources ?? [])].filter(Boolean),
    8,
    80,
  );
  const evidence: StoryDnaEvidence = {
    synopsis: cleanText(input.synopsis ?? input.description, 4_000) || null,
    genres: cleanList(input.genres, 12, 60),
    keywords: cleanList(input.keywords, 32, 60),
    languages: cleanList(input.languages, 12, 60),
    countries: cleanList(input.countries, 12, 60),
    runtime_minutes: normalizedRuntime(input.runtime_minutes),
    release_state: cleanText(input.release_state, 60, true) || null,
    format: cleanText(input.format, 60, true) || null,
    cast: cleanList(input.cast, 20, 100, false),
    characters: cleanList(input.characters, 20, 100, false),
    directors: cleanList(input.directors, 12, 100, false),
    writers: cleanList(input.writers, 12, 100, false),
    awards_certification: cleanList(input.awards_certification, 16, 120, false),
    external_ids: cleanExternalIds(input.external_ids),
    curated_pool_memberships: cleanList(
      input.curated_pool_memberships ?? input.rail_ids,
      20,
      80,
    ),
    sources: sources.length > 0 ? sources : ['catalog'],
    retrieved_at: cleanText(input.retrieved_at, 48) || null,
    field_provenance: cleanFieldProvenance(input.field_provenance),
  };
  const year = cleanText(input.year, 12) || null;
  return {
    type: input.type,
    id: cleanText(input.id, 160),
    title: cleanText(input.title, 160),
    year,
    evidence,
    selective_lookup: lookupMarker(input, evidence, year),
  };
}

function evidenceEnvelope(input: StoryDnaInput): Omit<StoryDnaRequestItem, 'selective_lookup'> {
  const { selective_lookup: _lookup, ...evidence } = storyDnaRequestItem(input);
  return evidence;
}

export function storyDnaInputHash(input: StoryDnaInput): string {
  return sha256(storyDnaRequestItem(input));
}

export function storyDnaEvidenceHash(input: StoryDnaInput): string {
  return sha256(evidenceEnvelope(input));
}

export function storyDnaEvidenceFields(input: StoryDnaInput): StoryDnaEvidenceField[] {
  const request = storyDnaRequestItem(input);
  const fields: StoryDnaEvidenceField[] = ['title'];
  if (request.year) fields.push('year');
  const pairs: Array<[StoryDnaEvidenceField, unknown]> = [
    ['synopsis', request.evidence.synopsis], ['genres', request.evidence.genres],
    ['keywords', request.evidence.keywords], ['languages', request.evidence.languages],
    ['countries', request.evidence.countries],
    ['runtime-minutes', request.evidence.runtime_minutes],
    ['release-state', request.evidence.release_state], ['format', request.evidence.format],
    ['cast', request.evidence.cast], ['characters', request.evidence.characters],
    ['directors', request.evidence.directors], ['writers', request.evidence.writers],
    ['awards-certification', request.evidence.awards_certification],
    ['external-ids', request.evidence.external_ids],
    ['curated-pool-memberships', request.evidence.curated_pool_memberships],
    ['source', request.evidence.sources], ['retrieved-at', request.evidence.retrieved_at],
    ['field-provenance', request.evidence.field_provenance],
  ];
  for (const [field, value] of pairs) {
    const present = Array.isArray(value) ? value.length > 0
      : value && typeof value === 'object' ? Object.keys(value).length > 0
        : value !== null && value !== '';
    if (present) fields.push(field);
  }
  return fields;
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`StoryDNA ${field} must be an object`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`StoryDNA ${field} is partial or has additional properties`);
  }
}

function assertEnum(value: unknown, allowed: readonly string[], field: string): asserts value is string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(`StoryDNA ${field} is invalid`);
}

function assertEnumList(
  value: unknown,
  allowed: readonly string[],
  field: string,
  max: number,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max
    || new Set(value).size !== value.length
    || value.some((item) => typeof item !== 'string' || !allowed.includes(item))
    || (value.includes('none') && value.length !== 1)) {
    throw new Error(`StoryDNA ${field} must be a complete bounded ontology list`);
  }
}

function assertUnit(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`StoryDNA ${field} must be between 0 and 1`);
  }
}

function assertOrdinal(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4) {
    throw new Error(`StoryDNA ${field} must be an integer from 0 to 4`);
  }
}

export function validateStoryDnaDocument(value: unknown, allowedStableIds: Set<string>): StoryDnaDocument {
  assertObject(value, 'document');
  assertExactKeys(value, STORY_DNA_JSON_SCHEMA.required, 'document');
  const document = value as unknown as StoryDnaDocument;
  const schema = STORY_DNA_JSON_SCHEMA.properties;
  if ((document.type !== 'movie' && document.type !== 'series')
    || typeof document.id !== 'string' || !document.id
    || !allowedStableIds.has(`${document.type}:${document.id}`)) {
    throw new Error('StoryDNA document references an unknown stable id');
  }
  if (document.schema_version !== STORY_DNA_SCHEMA_VERSION
    || document.ontology_version !== STORY_DNA_ONTOLOGY_VERSION
    || document.teacher_role !== 'content-only'
    || document.prompt_version !== STORY_DNA_PROMPT_VERSION
    || typeof document.model_version !== 'string' || !document.model_version.trim()
    || !/^[a-f0-9]{64}$/.test(document.input_hash)) {
    throw new Error('StoryDNA document has incompatible schema or provenance');
  }
  assertEnumList(
    document.genre_subgenres,
    schema.genre_subgenres.items.enum,
    'genre_subgenres',
    schema.genre_subgenres.maxItems,
  );
  assertEnum(document.format, schema.format.enum, 'format');
  assertEnumList(
    document.story_engines,
    schema.story_engines.items.enum,
    'story_engines',
    schema.story_engines.maxItems,
  );
  assertEnumList(document.themes, schema.themes.items.enum, 'themes', schema.themes.maxItems);
  assertEnumList(
    document.character_dynamics,
    schema.character_dynamics.items.enum,
    'character_dynamics',
    schema.character_dynamics.maxItems,
  );
  assertEnumList(document.tone, schema.tone.items.enum, 'tone', schema.tone.maxItems);
  assertEnum(document.setting_era, schema.setting_era.enum, 'setting_era');
  assertEnum(document.geographic_scope, schema.geographic_scope.enum, 'geographic_scope');
  assertEnumList(
    document.social_settings,
    schema.social_settings.items.enum,
    'social_settings',
    schema.social_settings.maxItems,
  );
  assertEnumList(
    document.narrative_structures,
    schema.narrative_structures.items.enum,
    'narrative_structures',
    schema.narrative_structures.maxItems,
  );
  assertEnum(
    document.ending_emotional_arc,
    schema.ending_emotional_arc.enum,
    'ending_emotional_arc',
  );
  assertObject(document.facets, 'facets');
  assertExactKeys(document.facets, schema.facets.required, 'facets');
  for (const field of STORY_DNA_FACET_KEYS) assertOrdinal(document.facets[field], `facets.${field}`);
  assertObject(document.confidence, 'confidence');
  assertExactKeys(document.confidence, schema.confidence.required, 'confidence');
  for (const field of STORY_DNA_CONFIDENCE_KEYS) assertUnit(document.confidence[field], `confidence.${field}`);
  assertObject(document.provenance, 'provenance');
  assertExactKeys(
    document.provenance,
    schema.provenance.required,
    'provenance',
  );
  if (document.provenance.teacher !== 'llm-content-teacher'
    || document.provenance.content_only !== true
    || !/^[a-f0-9]{64}$/.test(document.provenance.evidence_hash)
    || !Array.isArray(document.provenance.evidence_fields)
    || document.provenance.evidence_fields.length < 1
    || new Set(document.provenance.evidence_fields).size !== document.provenance.evidence_fields.length
    || document.provenance.evidence_fields.some((field) => !STORY_DNA_EVIDENCE_FIELDS.includes(field))
    || !Array.isArray(document.provenance.sources)
    || document.provenance.sources.length < 1 || document.provenance.sources.length > 8
    || new Set(document.provenance.sources).size !== document.provenance.sources.length
    || document.provenance.sources.some((source) => typeof source !== 'string' || !source || source.length > 80)) {
    throw new Error('StoryDNA provenance is invalid');
  }
  assertObject(document.selective_lookup, 'selective_lookup');
  assertExactKeys(document.selective_lookup, schema.selective_lookup.required, 'selective_lookup');
  if (typeof document.selective_lookup.requested !== 'boolean'
    || document.selective_lookup.policy !== 'structured-only'
    || typeof document.selective_lookup.used !== 'boolean'
    || (document.selective_lookup.used && !document.selective_lookup.requested)
    || !Array.isArray(document.selective_lookup.reasons)
    || new Set(document.selective_lookup.reasons).size !== document.selective_lookup.reasons.length
    || document.selective_lookup.reasons.some((reason) => !STORY_DNA_LOOKUP_REASONS.includes(reason))
    || document.selective_lookup.requested !== (document.selective_lookup.reasons.length > 0)) {
    throw new Error('StoryDNA selective lookup marker is invalid');
  }
  return document;
}

export function storyDnaDocumentHash(document: StoryDnaDocument): string {
  return sha256(document);
}

export type StoryDnaGraphEdge = {
  node_key: string;
  family: string;
  intensity: number;
  confidence: number;
  edge_source: 'teacher' | 'metadata' | 'compound';
};

function nodeKey(family: string, value: string): string {
  return `${family}:${encodeURIComponent(value.trim().toLowerCase())}`;
}

/** Fixed, versioned ontology parents. Parent nodes are folded into each title. */
const STORY_DNA_FIXED_PARENT_VALUES: Record<string, Record<string, string>> = {
  'genre-subgenre': {
    action: 'high-motion', adventure: 'high-motion', thriller: 'high-motion', war: 'high-motion', western: 'high-motion',
    crime: 'danger-mystery', mystery: 'danger-mystery', horror: 'danger-mystery',
    drama: 'relationship-drama', romance: 'relationship-drama', family: 'relationship-drama',
    documentary: 'factual', biography: 'factual', history: 'factual',
    comedy: 'entertainment', music: 'entertainment', musical: 'entertainment', reality: 'entertainment', talk: 'entertainment', sport: 'entertainment',
    animation: 'speculative', fantasy: 'speculative', 'sci-fi': 'speculative',
  },
  format: {
    'feature-film': 'film', 'short-film': 'film', 'documentary-feature': 'film', special: 'film',
    miniseries: 'series', 'limited-series': 'series', 'ongoing-series': 'series', 'anthology-series': 'series',
    'documentary-series': 'nonfiction', 'reality-series': 'unscripted', 'talk-series': 'unscripted',
  },
  'story-engine': {
    investigation: 'problem-solving', procedural: 'problem-solving', heist: 'problem-solving',
    quest: 'goal-conflict', survival: 'goal-conflict', revenge: 'goal-conflict', rivalry: 'goal-conflict',
    romance: 'relationships', friendship: 'relationships', 'family-conflict': 'relationships', 'coming-of-age': 'relationships',
    'rise-and-fall': 'character-change', transformation: 'character-change', biography: 'character-change',
    workplace: 'systems', 'political-struggle': 'systems', 'social-issue': 'systems',
    'slice-of-life': 'observational', anthology: 'observational',
  },
  theme: {
    family: 'connection', belonging: 'connection', love: 'connection', friendship: 'connection', community: 'connection',
    identity: 'inner-life', faith: 'inner-life', grief: 'inner-life', redemption: 'inner-life', morality: 'inner-life', obsession: 'inner-life', legacy: 'inner-life',
    ambition: 'society', power: 'society', justice: 'society', duty: 'society', freedom: 'society', class: 'society', prejudice: 'society',
    survival: 'world', nature: 'world', technology: 'world',
  },
  'character-dynamic': {
    'lone-protagonist': 'individual', 'antihero-society': 'individual',
    'romantic-pair': 'pair', rivals: 'pair', 'mentor-student': 'pair', partners: 'pair',
    'found-family': 'family-group', 'parent-child': 'family-group', siblings: 'family-group',
    ensemble: 'group', team: 'group',
  },
  tone: {
    warm: 'bright', hopeful: 'bright', playful: 'bright', witty: 'bright', absurd: 'bright', romantic: 'bright', triumphant: 'bright',
    earnest: 'reflective', contemplative: 'reflective', melancholic: 'reflective',
    dark: 'intense', gritty: 'intense', suspenseful: 'intense', frightening: 'intense', cynical: 'intense',
  },
  'setting-era': {
    ancient: 'historical', medieval: 'historical', 'early-modern': 'historical', 'nineteenth-century': 'historical',
    'early-twentieth-century': 'historical', 'mid-twentieth-century': 'historical', 'late-twentieth-century': 'historical',
    contemporary: 'present-day', 'near-future': 'future', 'far-future': 'future', timeless: 'atemporal', mixed: 'atemporal',
  },
  'geographic-scope': {
    'single-location': 'local', neighborhood: 'local', city: 'local', regional: 'local',
    national: 'wide', global: 'wide', cosmic: 'speculative-space', virtual: 'speculative-space', mixed: 'wide',
  },
  'social-setting': {
    domestic: 'everyday-institutions', school: 'everyday-institutions', workplace: 'everyday-institutions',
    military: 'power-institutions', political: 'power-institutions', 'criminal-underworld': 'power-institutions',
    'wealth-elite': 'community-class', 'working-class': 'community-class', 'rural-community': 'community-class', 'urban-community': 'community-class', religious: 'community-class',
    sports: 'vocational', 'entertainment-industry': 'vocational', scientific: 'vocational', wilderness: 'frontier',
  },
  'narrative-structure': {
    linear: 'continuous', framed: 'continuous', serialized: 'serialized-longform',
    nonlinear: 'complex', 'multiple-timelines': 'complex', 'unreliable-narrator': 'complex',
    episodic: 'modular', anthology: 'modular', procedural: 'modular',
  },
  'ending-emotional-arc': {
    uplifting: 'positive-resolution', redemptive: 'positive-resolution', triumphant: 'positive-resolution',
    bittersweet: 'mixed-open', ambiguous: 'mixed-open', 'open-ended': 'mixed-open', cyclical: 'mixed-open',
    tragic: 'negative-resolution', downbeat: 'negative-resolution',
  },
};

function fixedParentValue(family: string, value: string): string | null {
  return STORY_DNA_FIXED_PARENT_VALUES[family]?.[value.trim().toLowerCase()] ?? null;
}

/** Returns the persisted fixed parent for a concrete ontology node, if any. */
export function storyDnaOntologyParentNodeKey(childNodeKey: string): string | null {
  const separator = childNodeKey.indexOf(':');
  if (separator <= 0) return null;
  const family = childNodeKey.slice(0, separator);
  let value: string;
  try {
    value = decodeURIComponent(childNodeKey.slice(separator + 1));
  } catch {
    return null;
  }
  if (value.startsWith('parent=')) return null;
  const parent = fixedParentValue(family, value);
  return parent ? nodeKey(family, `parent=${parent}`) : null;
}

/** Converts one complete document into deterministic title-to-ontology edges. */
export function storyDnaToGraphEdges(
  document: StoryDnaDocument,
  input?: StoryDnaInput,
): StoryDnaGraphEdge[] {
  const edges = new Map<string, StoryDnaGraphEdge>();
  const add = (
    family: string,
    value: string,
    intensity: number,
    confidence: number,
    edgeSource: StoryDnaGraphEdge['edge_source'],
  ) => {
    if (!value) return;
    const edge: StoryDnaGraphEdge = {
      node_key: nodeKey(family, value), family, intensity, confidence, edge_source: edgeSource,
    };
    const previous = edges.get(edge.node_key);
    if (!previous || edge.intensity > previous.intensity) edges.set(edge.node_key, edge);
    const parent = fixedParentValue(family, value);
    if (parent) {
      const parentEdge: StoryDnaGraphEdge = {
        node_key: nodeKey(family, `parent=${parent}`),
        family,
        intensity: 1,
        confidence: Math.max(0, Math.min(1, confidence * 0.9)),
        edge_source: 'compound',
      };
      const previousParent = edges.get(parentEdge.node_key);
      if (!previousParent || parentEdge.confidence > previousParent.confidence) {
        edges.set(parentEdge.node_key, parentEdge);
      }
    }
  };
  const addMany = (
    family: string,
    values: readonly string[],
    confidence: number,
    source: StoryDnaGraphEdge['edge_source'] = 'teacher',
  ) => values.forEach((value, index) => add(
    family,
    value,
    // Teacher arrays are contractually ordered strongest-first. Reciprocal
    // salience preserves per-value emphasis while the family is normalized to
    // unit mass. Deterministic metadata facts remain equally weighted.
    source === 'teacher' ? 4 / (index + 1) : 1,
    confidence,
    source,
  ));

  addMany('genre-subgenre', document.genre_subgenres, document.confidence.genre_subgenre);
  const catalogFormat = input ? storyDnaRequestItem(input).evidence.format?.trim().toLowerCase() : null;
  // Format is deterministic only when canonical catalog evidence already uses
  // the controlled value. Otherwise it remains a content-teacher edge; the
  // graph must not relabel an inference as metadata truth.
  add(
    'format',
    document.format,
    1,
    document.confidence.format,
    catalogFormat === document.format ? 'metadata' : 'teacher',
  );
  addMany('story-engine', document.story_engines, document.confidence.story_engine);
  addMany('theme', document.themes, document.confidence.themes);
  addMany('character-dynamic', document.character_dynamics, document.confidence.character_dynamics);
  addMany('tone', document.tone, document.confidence.tone);
  add('setting-era', document.setting_era, 1, document.confidence.setting_era, 'teacher');
  add('geographic-scope', document.geographic_scope, 1, document.confidence.geographic_scope, 'teacher');
  addMany('social-setting', document.social_settings, document.confidence.social_setting);
  addMany('narrative-structure', document.narrative_structures, document.confidence.narrative_structure);
  add('ending-emotional-arc', document.ending_emotional_arc, 1, document.confidence.ending_emotional_arc, 'teacher');
  for (const facet of STORY_DNA_FACET_KEYS) {
    add(`facet.${facet}`, facet, document.facets[facet], document.confidence.facets, 'teacher');
  }

  if (input) {
    const request = storyDnaRequestItem(input);
    addMany('language', request.evidence.languages, 1, 'metadata');
    addMany('country', request.evidence.countries, 1, 'metadata');
    addMany('creator', [...request.evidence.directors, ...request.evidence.writers], 1, 'metadata');
    const year = Number.parseInt(request.year ?? '', 10);
    if (Number.isInteger(year) && year >= 1880 && year <= 2200) {
      add('decade', `${Math.floor(year / 10) * 10}s`, 1, 1, 'metadata');
    }
  }

  const categorical = (values: readonly string[]) => values.filter((value) => value !== 'none');
  for (const engine of categorical(document.story_engines)) {
    for (const tone of categorical(document.tone)) {
      add(
        'compound', `story-engine=${engine}&tone=${tone}`, 1,
        Math.min(document.confidence.story_engine, document.confidence.tone), 'compound',
      );
    }
  }
  for (const theme of categorical(document.themes)) {
    for (const dynamic of categorical(document.character_dynamics)) {
      add(
        'compound', `theme=${theme}&character-dynamic=${dynamic}`, 1,
        Math.min(document.confidence.themes, document.confidence.character_dynamics), 'compound',
      );
    }
  }
  // Fixed setting/conflict intersections retain the difference between, for
  // example, a domestic family conflict and a political family conflict. The
  // values are controlled StoryDNA enums; no free-form compound is accepted.
  for (const setting of categorical(document.social_settings)) {
    for (const engine of categorical(document.story_engines)) {
      add(
        'compound', `social-setting=${setting}&story-engine=${engine}`, 1,
        Math.min(document.confidence.social_setting, document.confidence.story_engine),
        'compound',
      );
    }
  }
  if (document.facets.pace > 0) {
    for (const genre of categorical(document.genre_subgenres)) {
      add(
        'compound', `genre=${genre}&pace=${document.facets.pace}`,
        1,
        Math.min(document.confidence.genre_subgenre, document.confidence.facets),
        'compound',
      );
    }
  }
  return [...edges.values()].sort((left, right) => left.node_key.localeCompare(right.node_key));
}

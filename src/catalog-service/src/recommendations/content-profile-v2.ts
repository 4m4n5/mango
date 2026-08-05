import { createHash } from 'node:crypto';
import {
  STORY_DNA_CHARACTER_DYNAMICS,
  STORY_DNA_FORMATS,
  STORY_DNA_GENRE_SUBGENRES,
  STORY_DNA_ONTOLOGY_VERSION,
  STORY_DNA_STORY_ENGINES,
  STORY_DNA_THEMES,
  STORY_DNA_TONES,
  stableStoryDnaJson,
  storyDnaDocumentHash,
  storyDnaRequestItem,
  storyDnaToGraphEdges,
  type StoryDnaDocument,
  type StoryDnaInput,
} from './story-dna.js';
import {
  STORY_GRAPH_FAMILIES,
  type StoryGraphEdge,
  type StoryGraphFamily,
  type StoryGraphTitle,
} from './story-graph-v1.js';

export const VOD_CONTENT_PROFILE_VERSION = 'vod-content-profile-v2' as const;
export const VOD_CONTENT_PROFILE_COMPILER_VERSION = 'vod-content-compiler-v1' as const;
export const VOD_STORY_FRONTIER_MODEL_VERSION = 'vod-story-frontier-v1' as const;

export type ContentProfileFamilyState = 'observed' | 'known_absent' | 'unknown';
export type ContentProfileEdgeSource =
  | 'metadata_fact'
  | 'curated_theme'
  | 'deterministic_rule'
  | 'llm_teacher'
  | 'compound'
  | 'mixed';

export type ContentProfileFamilyCoverage = Record<StoryGraphFamily, {
  state: ContentProfileFamilyState;
  source: ContentProfileEdgeSource | null;
  confidence: number;
}>;

export type ContentProfileState = 'base' | 'enriched' | 'sparse_unresolved' | 'unrankable';

export type ContentProfileV2 = {
  profile_version: typeof VOD_CONTENT_PROFILE_VERSION;
  compiler_version: typeof VOD_CONTENT_PROFILE_COMPILER_VERSION;
  ontology_version: typeof STORY_DNA_ONTOLOGY_VERSION;
  type: StoryDnaInput['type'];
  id: string;
  title: string;
  year: string | null;
  semantic_evidence_hash: string;
  base_feature_hash: string;
  teacher_document_hash: string | null;
  profile_hash: string;
  profile_state: ContentProfileState;
  feature_confidence: number;
  substantive_family_count: number;
  substantive_confidence_mass: number;
  family_coverage: ContentProfileFamilyCoverage;
  edges: StoryGraphEdge[];
};

const CONTENT_BEARING_FAMILIES = new Set<StoryGraphFamily>([
  'genre-subgenre', 'story-engine', 'theme', 'character-dynamic', 'tone',
]);

const SINGLE_CHOICE_FAMILIES = new Set<StoryGraphFamily>([
  'format', 'setting-era', 'geographic-scope', 'narrative-structure',
  'ending-emotional-arc', 'decade', 'runtime',
]);

const SOURCE_PRIORITY: Record<ContentProfileEdgeSource, number> = {
  metadata_fact: 6,
  mixed: 5,
  llm_teacher: 4,
  curated_theme: 3,
  deterministic_rule: 2,
  compound: 1,
};

const GENRE_ALIASES: Record<string, typeof STORY_DNA_GENRE_SUBGENRES[number]> = {
  'science-fiction': 'sci-fi', 'science-fiction-and-fantasy': 'sci-fi',
  'sci-fi': 'sci-fi', scifi: 'sci-fi', 'sci-fi-and-fantasy': 'sci-fi',
  'documentaries': 'documentary', 'docuseries': 'documentary',
  'war-and-politics': 'war', 'action-and-adventure': 'action',
};

type ControlledRule = {
  family: Extract<StoryGraphFamily, 'story-engine' | 'theme' | 'character-dynamic' | 'tone'>;
  value: string;
  phrases: readonly string[];
  confidence: number;
};

/** Deliberately small and auditable. Generic genre-to-tone inference is forbidden. */
export const CONTENT_PROFILE_CONTROLLED_RULES: readonly ControlledRule[] = [
  { family: 'story-engine', value: 'investigation', phrases: ['investigation', 'detective investigation', 'murder investigation'], confidence: 0.88 },
  { family: 'story-engine', value: 'quest', phrases: ['quest', 'epic quest'], confidence: 0.86 },
  { family: 'story-engine', value: 'survival', phrases: ['fight for survival', 'survival story', 'stranded'], confidence: 0.88 },
  { family: 'story-engine', value: 'rivalry', phrases: ['rivalry', 'bitter rivals'], confidence: 0.86 },
  { family: 'story-engine', value: 'heist', phrases: ['heist', 'bank robbery', 'master thief'], confidence: 0.92 },
  { family: 'story-engine', value: 'revenge', phrases: ['revenge', 'vengeance'], confidence: 0.90 },
  { family: 'story-engine', value: 'family-conflict', phrases: ['family conflict', 'dysfunctional family'], confidence: 0.88 },
  { family: 'story-engine', value: 'coming-of-age', phrases: ['coming of age', 'coming-of-age'], confidence: 0.94 },
  { family: 'story-engine', value: 'workplace', phrases: ['workplace comedy', 'workplace drama'], confidence: 0.90 },
  { family: 'story-engine', value: 'political-struggle', phrases: ['political struggle', 'political power struggle'], confidence: 0.90 },
  { family: 'story-engine', value: 'social-issue', phrases: ['social issue', 'social injustice'], confidence: 0.86 },
  { family: 'story-engine', value: 'friendship', phrases: ['friendship', 'best friends'], confidence: 0.84 },
  { family: 'story-engine', value: 'slice-of-life', phrases: ['slice of life', 'slice-of-life'], confidence: 0.94 },
  { family: 'story-engine', value: 'procedural', phrases: ['police procedural', 'medical procedural', 'legal procedural'], confidence: 0.92 },
  { family: 'story-engine', value: 'anthology', phrases: ['anthology'], confidence: 0.94 },
  { family: 'story-engine', value: 'biography', phrases: ['biography', 'biographical'], confidence: 0.90 },
  { family: 'theme', value: 'family', phrases: ['family bonds', 'family legacy'], confidence: 0.88 },
  { family: 'theme', value: 'belonging', phrases: ['sense of belonging', 'search for belonging'], confidence: 0.88 },
  { family: 'theme', value: 'friendship', phrases: ['friendship', 'best friends'], confidence: 0.84 },
  { family: 'theme', value: 'identity', phrases: ['crisis of identity', 'search for identity'], confidence: 0.88 },
  { family: 'theme', value: 'justice', phrases: ['fight for justice', 'pursuit of justice'], confidence: 0.88 },
  { family: 'theme', value: 'grief', phrases: ['coping with grief', 'overcome grief'], confidence: 0.90 },
  { family: 'theme', value: 'redemption', phrases: ['redemption', 'second chance'], confidence: 0.86 },
  { family: 'theme', value: 'class', phrases: ['class conflict', 'class divide'], confidence: 0.90 },
  { family: 'theme', value: 'community', phrases: ['community bonds', 'local community'], confidence: 0.84 },
  { family: 'theme', value: 'survival', phrases: ['fight for survival', 'survival story'], confidence: 0.88 },
  { family: 'theme', value: 'obsession', phrases: ['dangerous obsession', 'consumed by obsession'], confidence: 0.90 },
  { family: 'theme', value: 'prejudice', phrases: ['racial prejudice', 'social prejudice'], confidence: 0.90 },
  { family: 'theme', value: 'technology', phrases: ['artificial intelligence', 'technology and society'], confidence: 0.88 },
  { family: 'character-dynamic', value: 'found-family', phrases: ['found family'], confidence: 0.94 },
  { family: 'character-dynamic', value: 'parent-child', phrases: ['parent child', 'parent-child', 'father and son', 'mother and daughter'], confidence: 0.90 },
  { family: 'character-dynamic', value: 'siblings', phrases: ['estranged siblings', 'brothers and sisters'], confidence: 0.88 },
  { family: 'character-dynamic', value: 'rivals', phrases: ['bitter rivals', 'rival duo'], confidence: 0.88 },
  { family: 'character-dynamic', value: 'mentor-student', phrases: ['mentor and student', 'mentor-student'], confidence: 0.92 },
  { family: 'tone', value: 'warm', phrases: ['heartwarming', 'warm-hearted'], confidence: 0.88 },
  { family: 'tone', value: 'witty', phrases: ['witty comedy', 'witty dialogue'], confidence: 0.88 },
  { family: 'tone', value: 'absurd', phrases: ['absurdist', 'absurd comedy'], confidence: 0.90 },
  { family: 'tone', value: 'melancholic', phrases: ['melancholic', 'melancholy'], confidence: 0.90 },
  { family: 'tone', value: 'gritty', phrases: ['gritty realism', 'gritty crime'], confidence: 0.88 },
  { family: 'tone', value: 'suspenseful', phrases: ['suspenseful', 'slow-burn suspense'], confidence: 0.88 },
  { family: 'tone', value: 'frightening', phrases: ['frightening', 'terrifying'], confidence: 0.86 },
] as const;

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStoryDnaJson(value)).digest('hex');
}

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizedList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeToken).filter(Boolean))].sort();
}

function yearValue(value: StoryDnaInput['year']): string | null {
  const match = String(value ?? '').match(/\b(18|19|20|21)\d{2}\b/);
  return match?.[0] ?? null;
}

export function contentSemanticEvidence(input: StoryDnaInput): Record<string, unknown> {
  const request = storyDnaRequestItem(input);
  return {
    type: request.type,
    id: request.id,
    title: normalizeToken(request.title),
    year: yearValue(request.year),
    synopsis: request.evidence.synopsis?.trim().replace(/\s+/g, ' ') ?? null,
    genres: normalizedList(request.evidence.genres),
    keywords: normalizedList(request.evidence.keywords),
    languages: normalizedList(request.evidence.languages),
    countries: normalizedList(request.evidence.countries),
    runtime_minutes: request.evidence.runtime_minutes,
    release_state: normalizeToken(request.evidence.release_state),
    format: normalizeToken(request.evidence.format),
    cast: normalizedList(request.evidence.cast),
    characters: normalizedList(request.evidence.characters),
    directors: normalizedList(request.evidence.directors),
    writers: normalizedList(request.evidence.writers),
    awards_certification: normalizedList(request.evidence.awards_certification),
    external_ids: Object.fromEntries(Object.entries(request.evidence.external_ids).sort()),
  };
}

export function contentSemanticEvidenceHash(input: StoryDnaInput): string {
  return sha256(contentSemanticEvidence(input));
}

function edge(
  family: StoryGraphFamily,
  value: string,
  confidence: number,
  source: ContentProfileEdgeSource,
  intensity = 1,
  ordinal = false,
): StoryGraphEdge | null {
  const token = normalizeToken(value);
  if (!token) return null;
  return {
    family,
    node_key: `${family}:${token}`,
    intensity,
    confidence: Math.max(0, Math.min(1, confidence)),
    ordinal,
    source,
  };
}

function metadataEdges(input: StoryDnaInput): StoryGraphEdge[] {
  const output: StoryGraphEdge[] = [];
  const add = (candidate: StoryGraphEdge | null) => { if (candidate) output.push(candidate); };
  const genres = normalizedList(input.genres).map((value) => GENRE_ALIASES[value] ?? value)
    .filter((value): value is typeof STORY_DNA_GENRE_SUBGENRES[number] => (
      value !== 'none' && (STORY_DNA_GENRE_SUBGENRES as readonly string[]).includes(value)
    ));
  for (const value of genres) add(edge('genre-subgenre', value, 1, 'metadata_fact'));

  const rawFormat = normalizeToken(input.format);
  const format = (STORY_DNA_FORMATS as readonly string[]).includes(rawFormat) && rawFormat !== 'none'
    ? rawFormat
    : input.type === 'movie' ? 'feature-film' : 'ongoing-series';
  add(edge('format', format, rawFormat ? 1 : 0.9, 'metadata_fact'));

  for (const value of normalizedList(input.languages)) add(edge('language', value, 1, 'metadata_fact'));
  for (const value of normalizedList(input.countries)) add(edge('country', value, 1, 'metadata_fact'));
  const year = yearValue(input.year);
  if (year) add(edge('decade', `${year.slice(0, 3)}0s`, 1, 'metadata_fact'));
  if (input.runtime_minutes && Number.isFinite(input.runtime_minutes)) {
    const minutes = Number(input.runtime_minutes);
    const band = minutes < 40 ? 'under-40' : minutes < 70 ? '40-69'
      : minutes < 100 ? '70-99' : minutes < 130 ? '100-129' : '130-plus';
    add(edge('runtime', band, 1, 'metadata_fact'));
  }
  for (const value of normalizedList(input.cast).slice(0, 12)) add(edge('cast', value, 1, 'metadata_fact'));
  for (const value of normalizedList(input.directors).slice(0, 6)) add(edge('director', value, 1, 'metadata_fact'));
  for (const value of normalizedList(input.writers).slice(0, 6)) add(edge('writer', value, 1, 'metadata_fact'));
  // The legacy evidence field combines awards and certification. Only a
  // controlled rating token is factual serving evidence; awards never become
  // a quality proxy in recommendations.
  const certifications = normalizedList(input.awards_certification).filter((value) => (
    /^(g|pg|pg-13|r|nc-17|tv-y|tv-y7|tv-g|tv-pg|tv-14|tv-ma|u|ua|a|12a|12|15|18)$/.test(value)
  ));
  for (const value of certifications.slice(0, 2)) {
    add(edge('certification', value, 1, 'metadata_fact'));
  }
  for (const railId of normalizedList(input.curated_pool_memberships ?? input.rail_ids)
    .filter((value) => !value.startsWith('ai-catalog-')).slice(0, 12)) {
    add(edge('curated-list', railId, 0.8, 'curated_theme'));
  }
  return output;
}

function escapedPhrase(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
}

function deterministicRuleEdges(input: StoryDnaInput): StoryGraphEdge[] {
  const request = storyDnaRequestItem(input);
  const text = [...request.evidence.keywords, request.evidence.synopsis ?? '']
    .join(' ').toLowerCase().replace(/\s+/g, ' ');
  const output: StoryGraphEdge[] = [];
  for (const rule of CONTENT_PROFILE_CONTROLLED_RULES) {
    if (!rule.phrases.some((phrase) => escapedPhrase(phrase).test(text))) continue;
    const allowed = rule.family === 'story-engine' ? STORY_DNA_STORY_ENGINES
      : rule.family === 'theme' ? STORY_DNA_THEMES
        : rule.family === 'character-dynamic' ? STORY_DNA_CHARACTER_DYNAMICS
          : STORY_DNA_TONES;
    if (!(allowed as readonly string[]).includes(rule.value) || rule.value === 'none') continue;
    const candidate = edge(rule.family, rule.value, rule.confidence, 'deterministic_rule');
    if (candidate) output.push(candidate);
  }
  return output;
}

function teacherEdges(document: StoryDnaDocument, input: StoryDnaInput): StoryGraphEdge[] {
  return storyDnaToGraphEdges(document, input)
    .filter((item) => !item.node_key.endsWith(':none'))
    .map((item) => ({
    family: item.family as StoryGraphFamily,
    node_key: item.node_key,
    intensity: item.intensity,
    confidence: item.confidence,
    ordinal: item.family.startsWith('facet.'),
    source: item.edge_source === 'teacher' ? 'llm_teacher'
      : item.edge_source === 'compound' ? 'compound' : 'metadata_fact',
    }));
}

function mergeEdges(edges: readonly StoryGraphEdge[]): StoryGraphEdge[] {
  const merged = new Map<string, StoryGraphEdge>();
  for (const item of edges) {
    if (!(STORY_GRAPH_FAMILIES as readonly string[]).includes(item.family)) continue;
    const key = `${item.family}\u0000${item.node_key}\u0000${item.ordinal ? 1 : 0}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, item);
      continue;
    }
    const previousPriority = SOURCE_PRIORITY[previous.source as ContentProfileEdgeSource] ?? 0;
    const nextPriority = SOURCE_PRIORITY[item.source as ContentProfileEdgeSource] ?? 0;
    const preferred = item.confidence > previous.confidence
      || (item.confidence === previous.confidence && nextPriority > previousPriority)
      ? item : previous;
    merged.set(key, {
      ...preferred,
      confidence: Math.max(previous.confidence, item.confidence),
      source: previous.source === item.source ? previous.source : 'mixed',
    });
  }
  const values = [...merged.values()];
  const singleChoiceWinners = new Map<StoryGraphFamily, StoryGraphEdge>();
  for (const item of values.filter((candidate) => SINGLE_CHOICE_FAMILIES.has(candidate.family))) {
    const previous = singleChoiceWinners.get(item.family);
    if (!previous) {
      singleChoiceWinners.set(item.family, item);
      continue;
    }
    const itemTuple = [
      item.source === 'metadata_fact' ? 1 : 0,
      item.confidence,
      SOURCE_PRIORITY[item.source as ContentProfileEdgeSource] ?? 0,
    ] as const;
    const previousTuple = [
      previous.source === 'metadata_fact' ? 1 : 0,
      previous.confidence,
      SOURCE_PRIORITY[previous.source as ContentProfileEdgeSource] ?? 0,
    ] as const;
    const itemWins = itemTuple[0] > previousTuple[0]
      || (itemTuple[0] === previousTuple[0] && itemTuple[1] > previousTuple[1])
      || (itemTuple[0] === previousTuple[0] && itemTuple[1] === previousTuple[1]
        && itemTuple[2] > previousTuple[2])
      || (itemTuple[0] === previousTuple[0] && itemTuple[1] === previousTuple[1]
        && itemTuple[2] === previousTuple[2] && item.node_key < previous.node_key);
    if (itemWins) {
      singleChoiceWinners.set(item.family, item);
    }
  }
  return values.filter((item) => (
    !SINGLE_CHOICE_FAMILIES.has(item.family) || singleChoiceWinners.get(item.family) === item
  )).sort((left, right) => (
    left.family.localeCompare(right.family) || left.node_key.localeCompare(right.node_key)
  ));
}

function knownAbsentFamilies(document: StoryDnaDocument | null): Set<StoryGraphFamily> {
  if (!document) return new Set();
  const pairs: Array<[StoryGraphFamily, unknown]> = [
    ['genre-subgenre', document.genre_subgenres], ['format', document.format],
    ['story-engine', document.story_engines], ['theme', document.themes],
    ['character-dynamic', document.character_dynamics], ['tone', document.tone],
    ['setting-era', document.setting_era], ['geographic-scope', document.geographic_scope],
    ['social-setting', document.social_settings], ['narrative-structure', document.narrative_structures],
    ['ending-emotional-arc', document.ending_emotional_arc],
  ];
  return new Set(pairs.flatMap(([family, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.length > 0 && values.every((item) => item === 'none') ? [family] : [];
  }));
}

function coverageFor(edges: readonly StoryGraphEdge[], document: StoryDnaDocument | null): ContentProfileFamilyCoverage {
  const absent = knownAbsentFamilies(document);
  const grouped = new Map<StoryGraphFamily, StoryGraphEdge[]>();
  for (const item of edges) grouped.set(item.family, [...(grouped.get(item.family) ?? []), item]);
  return Object.fromEntries(STORY_GRAPH_FAMILIES.map((family) => {
    const items = grouped.get(family) ?? [];
    if (items.length > 0) {
      const sources = new Set(items.map((item) => item.source as ContentProfileEdgeSource));
      return [family, {
        state: 'observed' as const,
        source: sources.size === 1 ? [...sources][0]! : 'mixed' as const,
        confidence: items.reduce((sum, item) => sum + item.confidence, 0) / items.length,
      }];
    }
    return [family, {
      state: absent.has(family) ? 'known_absent' as const : 'unknown' as const,
      source: absent.has(family) ? 'llm_teacher' as const : null,
      confidence: absent.has(family) ? 1 : 0,
    }];
  })) as ContentProfileFamilyCoverage;
}

export function contentProfileIsServingEligible(profile: ContentProfileV2): boolean {
  if (profile.profile_state === 'unrankable') return false;
  const hasContentFamily = [...CONTENT_BEARING_FAMILIES].some(
    (family) => profile.family_coverage[family].state === 'observed',
  );
  return hasContentFamily
    && profile.substantive_family_count >= 2
    && profile.substantive_confidence_mass >= 1.5;
}

export function compileContentProfileV2(input: StoryDnaInput, options: {
  teacher_document?: StoryDnaDocument | null;
  /** Preserves fixed curated-theme evidence when a presentation rail disappears. */
  prior_profile?: ContentProfileV2 | null;
} = {}): ContentProfileV2 {
  const semanticHash = contentSemanticEvidenceHash(input);
  const priorCurated = options.prior_profile?.semantic_evidence_hash === semanticHash
    ? options.prior_profile.edges.filter((item) => item.source === 'curated_theme')
    : [];
  const teacher = options.teacher_document ?? null;
  const baseEdges = mergeEdges([
    ...metadataEdges(input),
    ...deterministicRuleEdges(input),
    ...priorCurated,
  ]);
  const edges = mergeEdges([
    ...baseEdges,
    ...(teacher ? teacherEdges(teacher, input) : []),
  ]);
  const familyCoverage = coverageFor(edges, teacher);
  const observed = Object.entries(familyCoverage).filter(([, value]) => value.state === 'observed');
  const substantive = observed.filter(([family]) => family !== 'compound');
  const substantiveConfidenceMass = substantive.reduce((sum, [, value]) => sum + value.confidence, 0);
  const baseFeatureHash = sha256(baseEdges);
  const teacherDocumentHash = teacher ? storyDnaDocumentHash(teacher) : null;
  const featureConfidence = STORY_GRAPH_FAMILIES.reduce(
    (sum, family) => sum + familyCoverage[family].confidence,
    0,
  ) / STORY_GRAPH_FAMILIES.length;
  const preliminary = {
    profile_version: VOD_CONTENT_PROFILE_VERSION,
    compiler_version: VOD_CONTENT_PROFILE_COMPILER_VERSION,
    ontology_version: STORY_DNA_ONTOLOGY_VERSION,
    type: input.type,
    id: input.id,
    title: input.title,
    year: yearValue(input.year),
    semantic_evidence_hash: semanticHash,
    base_feature_hash: baseFeatureHash,
    teacher_document_hash: teacherDocumentHash,
    feature_confidence: featureConfidence,
    substantive_family_count: substantive.length,
    substantive_confidence_mass: substantiveConfidenceMass,
    family_coverage: familyCoverage,
    edges,
  };
  const provisionalProfile = {
    ...preliminary,
    profile_hash: '',
    profile_state: teacher ? 'enriched' as const : 'base' as const,
  };
  const profileState: ContentProfileState = !input.title.trim()
    ? 'unrankable'
    : contentProfileIsServingEligible(provisionalProfile)
      ? (teacher ? 'enriched' : 'base')
      : 'sparse_unresolved';
  const profileHash = sha256({ ...preliminary, profile_state: profileState });
  return { ...preliminary, profile_hash: profileHash, profile_state: profileState };
}

export function contentProfileStoryGraphTitle(profile: ContentProfileV2): StoryGraphTitle {
  return {
    type: profile.type,
    id: profile.id,
    title: profile.title,
    year: profile.year,
    edges: profile.edges,
    family_coverage: profile.family_coverage,
    profile_hash: profile.profile_hash,
    profile_state: profile.profile_state,
  };
}

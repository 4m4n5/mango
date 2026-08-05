import { existsSync, readFileSync } from 'node:fs';
import type { StoryDnaInput } from './story-dna.js';

export type TmdbMetadataStatus = {
  enabled: boolean;
  requested: number;
  resolved: number;
  missing_id: number;
  conflicted: number;
  rate_limited: number;
  failed: number;
  updated_at: number | null;
  last_error: string | null;
};

type TmdbResponse = {
  id?: number;
  overview?: string;
  genres?: Array<{ id?: number; name?: string }>;
  spoken_languages?: Array<{ english_name?: string; name?: string }>;
  production_countries?: Array<{ name?: string }>;
  runtime?: number;
  episode_run_time?: number[];
  status?: string;
  created_by?: Array<{ name?: string }>;
  credits?: {
    cast?: Array<{ name?: string; character?: string; order?: number }>;
    crew?: Array<{ name?: string; job?: string; department?: string }>;
  };
  keywords?: { keywords?: Array<{ name?: string }>; results?: Array<{ name?: string }> };
  external_ids?: Record<string, unknown>;
  release_dates?: { results?: Array<{ iso_3166_1?: string; release_dates?: Array<{ certification?: string }> }> };
  content_ratings?: { results?: Array<{ iso_3166_1?: string; rating?: string }> };
};

const state: TmdbMetadataStatus = {
  enabled: false,
  requested: 0,
  resolved: 0,
  missing_id: 0,
  conflicted: 0,
  rate_limited: 0,
  failed: 0,
  updated_at: null,
  last_error: null,
};

let nextRequestAt = 0;
let requestTail = Promise.resolve();

function credential(): { header?: string; apiKey?: string } | null {
  const token = process.env.MANGO_TMDB_API_TOKEN?.trim();
  if (token) return { header: `Bearer ${token}` };
  const apiKey = process.env.MANGO_TMDB_API_KEY?.trim();
  if (apiKey) return { apiKey };
  const path = process.env.MANGO_TMDB_API_KEY_FILE?.trim() || '/etc/mango/tmdb.key';
  if (!existsSync(path)) return null;
  const value = readFileSync(path, 'utf8').trim();
  return value ? { apiKey: value } : null;
}

function boundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

async function rateLimit(): Promise<void> {
  const rate = boundedInteger(process.env.MANGO_TMDB_REQUESTS_PER_SECOND, 5, 1, 5);
  const spacing = Math.ceil(1_000 / rate);
  const gate = requestTail.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    nextRequestAt = Date.now() + spacing;
  });
  requestTail = gate.catch(() => undefined);
  await gate;
}

function tmdbId(input: StoryDnaInput): number | null {
  const candidates = [input.external_ids?.tmdb, input.external_ids?.tmdb_id];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  const catalog = input.id.match(/^tmdb:(\d+)$/i)?.[1];
  return catalog ? Number(catalog) : null;
}

function unique(values: Array<string | null | undefined>, limit: number): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
    .slice(0, limit);
}

function certification(response: TmdbResponse): string | null {
  const movie = response.release_dates?.results ?? [];
  const release = [...movie].sort((left, right) => (
    left.iso_3166_1 === 'US' ? -1 : right.iso_3166_1 === 'US' ? 1 : 0
  )).flatMap((item) => item.release_dates ?? []).find((item) => item.certification?.trim());
  if (release?.certification) return release.certification;
  const rating = [...(response.content_ratings?.results ?? [])].sort((left, right) => (
    left.iso_3166_1 === 'US' ? -1 : right.iso_3166_1 === 'US' ? 1 : 0
  )).find((item) => item.rating?.trim());
  return rating?.rating?.trim() || null;
}

function mergeResponse(input: StoryDnaInput, response: TmdbResponse): StoryDnaInput {
  const cast = [...(response.credits?.cast ?? [])]
    .sort((left, right) => (left.order ?? 999) - (right.order ?? 999));
  const crew = response.credits?.crew ?? [];
  const directors = crew.filter((item) => item.job === 'Director').map((item) => item.name);
  const writers = crew.filter((item) => ['Writer', 'Screenplay', 'Teleplay', 'Story'].includes(item.job ?? ''))
    .map((item) => item.name);
  const keywords = response.keywords?.keywords ?? response.keywords?.results ?? [];
  const runtime = response.runtime ?? response.episode_run_time?.find((value) => value > 0) ?? null;
  const currentSynopsis = input.synopsis?.trim() || input.description?.trim() || '';
  const source = 'tmdb-exact-id';
  const fields = {
    ...(input.field_provenance ?? {}),
    synopsis: currentSynopsis.length >= 120 ? input.field_provenance?.synopsis ?? [] : [source],
    genres: input.genres?.length ? input.field_provenance?.genres ?? [] : [source],
    keywords: [source], languages: [source], countries: [source], runtime_minutes: [source],
    cast: [source], characters: [source], directors: [source], writers: [source],
    certification: [source],
  };
  return {
    ...input,
    synopsis: currentSynopsis.length >= 120 ? currentSynopsis : response.overview?.trim() || currentSynopsis || null,
    genres: unique([...(input.genres ?? []), ...(response.genres ?? []).map((item) => item.name)], 12),
    keywords: unique([...(input.keywords ?? []), ...keywords.map((item) => item.name)], 32),
    languages: unique([
      ...(input.languages ?? []),
      ...(response.spoken_languages ?? []).map((item) => item.english_name ?? item.name),
    ], 12),
    countries: unique([...(input.countries ?? []), ...(response.production_countries ?? []).map((item) => item.name)], 12),
    runtime_minutes: input.runtime_minutes || runtime,
    release_state: input.release_state ?? response.status?.trim().toLowerCase() ?? null,
    cast: unique([...(input.cast ?? []), ...cast.map((item) => item.name)], 24),
    characters: unique([...(input.characters ?? []), ...cast.map((item) => item.character)], 24),
    directors: unique([...(input.directors ?? []), ...directors], 12),
    writers: unique([...(input.writers ?? []), ...writers], 16),
    awards_certification: unique([...(input.awards_certification ?? []), certification(response)], 8),
    external_ids: {
      ...(response.external_ids ?? {}),
      ...(input.external_ids ?? {}),
      tmdb: String(response.id),
    },
    source: input.source,
    evidence_sources: unique([...(input.evidence_sources ?? []), source], 8),
    field_provenance: fields,
    retrieved_at: Date.now(),
    lookup_used: true,
  };
}

async function fetchOne(input: StoryDnaInput, fetcher: typeof fetch): Promise<StoryDnaInput> {
  const credentials = credential();
  const id = tmdbId(input);
  state.enabled = Boolean(credentials);
  if (!credentials || !id) {
    if (!id) state.missing_id += 1;
    return input;
  }
  const namespace = input.type === 'series' ? 'tv' : 'movie';
  const append = input.type === 'series'
    ? 'keywords,credits,external_ids,content_ratings'
    : 'keywords,credits,external_ids,release_dates';
  const url = new URL(`https://api.themoviedb.org/3/${namespace}/${id}`);
  url.searchParams.set('append_to_response', append);
  if (credentials.apiKey) url.searchParams.set('api_key', credentials.apiKey);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await rateLimit();
    state.requested += 1;
    const response = await fetcher(url, {
      headers: credentials.header ? { authorization: credentials.header } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) {
      state.rate_limited += 1;
      if (attempt === 0) {
        const seconds = Math.max(1, Math.min(5, Number(response.headers.get('retry-after')) || 1));
        await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
        continue;
      }
    }
    if (!response.ok) throw new Error(`TMDB exact-id metadata returned ${response.status}`);
    const payload = await response.json() as TmdbResponse;
    if (payload.id !== id) {
      state.conflicted += 1;
      throw new Error('TMDB exact-id response identity mismatch');
    }
    state.resolved += 1;
    state.updated_at = Date.now();
    return mergeResponse(input, payload);
  }
  return input;
}

export async function enrichStoryDnaInputsWithTmdb(
  inputs: readonly StoryDnaInput[],
  options: { fetcher?: typeof fetch; limit?: number } = {},
): Promise<StoryDnaInput[]> {
  if (process.env.MANGO_TMDB_METADATA === 'off' || !credential()) {
    state.enabled = false;
    return [...inputs];
  }
  state.enabled = true;
  const limit = Math.max(0, Math.min(250, Math.floor(options.limit ?? 250)));
  const selected = inputs.slice(0, limit);
  const output = new Map(inputs.map((input) => [`${input.type}:${input.id}`, input]));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (cursor < selected.length) {
      const input = selected[cursor++];
      if (!input) continue;
      try {
        output.set(`${input.type}:${input.id}`, await fetchOne(input, options.fetcher ?? fetch));
      } catch (error) {
        state.failed += 1;
        state.last_error = error instanceof Error ? error.message : String(error);
        state.updated_at = Date.now();
      }
    }
  });
  await Promise.all(workers);
  return inputs.map((input) => output.get(`${input.type}:${input.id}`) ?? input);
}

export function tmdbMetadataStatus(): TmdbMetadataStatus {
  return { ...state };
}

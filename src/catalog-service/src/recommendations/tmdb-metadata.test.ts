import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoryDnaInput } from './story-dna.js';
import { enrichStoryDnaInputsWithTmdb } from './tmdb-metadata.js';

function input(overrides: Partial<StoryDnaInput> = {}): StoryDnaInput {
  return {
    type: 'movie', id: 'tt123', title: 'Example', year: '2020',
    synopsis: null, genres: [], keywords: [], external_ids: { tmdb: '123' },
    ...overrides,
  };
}

test('TMDB enrichment is exact-ID, bounded to factual fields, and preserves local facts', async () => {
  const prior = process.env.MANGO_TMDB_API_TOKEN;
  process.env.MANGO_TMDB_API_TOKEN = 'test-token';
  let requestedUrl = '';
  try {
    const [result] = await enrichStoryDnaInputsWithTmdb([input({ genres: ['Drama'] })], {
      fetcher: async (request) => {
        requestedUrl = String(request);
        return new Response(JSON.stringify({
          id: 123,
          overview: 'A grounded investigation into family and justice.',
          genres: [{ name: 'Crime' }],
          keywords: { keywords: [{ name: 'murder investigation' }] },
          spoken_languages: [{ english_name: 'Hindi' }],
          production_countries: [{ name: 'India' }],
          runtime: 111,
          status: 'Released',
          credits: {
            cast: [{ name: 'Actor One', character: 'Detective', order: 0 }],
            crew: [{ name: 'Director One', job: 'Director' }],
          },
          external_ids: { imdb_id: 'tt123' },
          release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.match(requestedUrl, /\/movie\/123/);
    assert.match(requestedUrl, /append_to_response=/);
    assert.deepEqual(result?.genres, ['Drama', 'Crime']);
    assert.equal(result?.runtime_minutes, 111);
    assert.deepEqual(result?.directors, ['Director One']);
    assert.deepEqual(result?.awards_certification, ['PG-13']);
    assert.equal((result?.external_ids as Record<string, unknown>).tmdb, '123');
    assert.equal('popularity' in (result as unknown as Record<string, unknown>), false);
  } finally {
    if (prior === undefined) delete process.env.MANGO_TMDB_API_TOKEN;
    else process.env.MANGO_TMDB_API_TOKEN = prior;
  }
});

test('TMDB never fuzzy-searches a title without a stable TMDB id', async () => {
  const prior = process.env.MANGO_TMDB_API_TOKEN;
  process.env.MANGO_TMDB_API_TOKEN = 'test-token';
  let calls = 0;
  try {
    const original = input({ external_ids: { imdb: 'tt123' } });
    const [result] = await enrichStoryDnaInputsWithTmdb([original], {
      fetcher: async () => {
        calls += 1;
        throw new Error('must not search');
      },
    });
    assert.equal(calls, 0);
    assert.deepEqual(result, original);
  } finally {
    if (prior === undefined) delete process.env.MANGO_TMDB_API_TOKEN;
    else process.env.MANGO_TMDB_API_TOKEN = prior;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ListSource, CandidateMeta } from './list-source.js';
import type { TitlePlayabilityRecord } from './db.js';
import {
  freshTargetPerRail,
  ingestPaginatedCandidates,
  isRecentFailedTitle,
} from './candidate-ingest.js';

class MockListSource implements ListSource {
  readonly sourceId = 'mock';
  readonly sourceType = 'addon_catalog' as const;

  constructor(private readonly pages: CandidateMeta[][]) {}

  async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
    const flat = this.pages.flat();
    return flat.slice(options.offset, options.offset + options.limit);
  }
}

function movie(id: string): CandidateMeta {
  return { id, type: 'movie' };
}

test('ingestPaginatedCandidates pages past verified and failed to find fresh titles', async () => {
  const source = new MockListSource([
    Array.from({ length: 20 }, (_, index) => movie(`seen-${index}`)),
    Array.from({ length: 20 }, (_, index) => movie(`fresh-${index}`)),
  ]);

  const statuses = new Map<string, TitlePlayabilityRecord>();
  for (let index = 0; index < 20; index += 1) {
    statuses.set(`movie:seen-${index}`, {
      type: 'movie',
      id: `seen-${index}`,
      status: index % 2 === 0 ? 'verified' : 'failed',
      fail_reason: 'timeout',
      expires_at: Date.now() + 60_000,
      updated_at: Date.now(),
    });
  }

  const result = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 10,
    pageSize: 10,
    maxScanned: 100,
    now: Date.now(),
    lookupTitles: async (candidates) => {
      const map = new Map<string, TitlePlayabilityRecord>();
      for (const candidate of candidates) {
        const key = `${candidate.type}:${candidate.id}`;
        const title = statuses.get(key);
        if (title) {
          map.set(key, title);
        }
      }
      return map;
    },
  });

  assert.equal(result.fresh_queued, 10);
  assert.equal(result.scanned, 30);
  assert.equal(result.next_offset, 30);
  assert.equal(result.candidates.filter((candidate) => candidate.id.startsWith('fresh-')).length, 10);
});

test('ingestPaginatedCandidates resets offset when catalog exhausted', async () => {
  const source = new MockListSource([
    [movie('a'), movie('b')],
  ]);

  const result = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 5,
    pageSize: 10,
    maxScanned: 50,
    lookupTitles: async () => new Map(),
  });

  assert.equal(result.catalog_exhausted, true);
  assert.equal(result.next_offset, 0);
  assert.equal(result.fresh_queued, 2);
});

test('isRecentFailedTitle respects retry window', () => {
  const now = Date.now();
  assert.equal(isRecentFailedTitle({
    type: 'movie',
    id: 'x',
    status: 'failed',
    fail_reason: 'timeout',
    expires_at: null,
    updated_at: now - 1000,
  }, now), true);
  assert.equal(isRecentFailedTitle({
    type: 'movie',
    id: 'x',
    status: 'failed',
    fail_reason: 'no_stream',
    expires_at: null,
    updated_at: now - 8 * 24 * 60 * 60 * 1000,
  }, now), false);
});

test('freshTargetPerRail splits total across working rails', () => {
  assert.equal(freshTargetPerRail(100, 12), 9);
  assert.equal(freshTargetPerRail(100, 4), 25);
});

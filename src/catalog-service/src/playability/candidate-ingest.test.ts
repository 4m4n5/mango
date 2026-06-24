import assert from 'node:assert/strict';
import test from 'node:test';
import type { ListSource, CandidateMeta } from './list-source.js';
import type { TitlePlayabilityRecord } from './db.js';
import type { SourceCursorListSource } from './source-cursors.js';
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
  assert.equal(result.scanned, 10);
  assert.equal(result.next_offset, 30);
  assert.equal(result.candidates.filter((candidate) => candidate.id.startsWith('fresh-')).length, 10);
});

test('ingestPaginatedCandidates can skip collecting active verified links during strict grow', async () => {
  const source = new MockListSource([
    Array.from({ length: 20 }, (_, index) => movie(`seen-${index}`)),
    Array.from({ length: 20 }, (_, index) => movie(`fresh-${index}`)),
  ]);
  const now = Date.now();

  const result = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 10,
    pageSize: 10,
    maxScanned: 100,
    now,
    collectActiveVerified: false,
    lookupTitles: async (candidates) => new Map(candidates
      .filter((candidate) => candidate.id.startsWith('seen-'))
      .map((candidate) => [`${candidate.type}:${candidate.id}`, {
        type: candidate.type,
        id: candidate.id,
        status: 'verified' as const,
        fail_reason: null,
        expires_at: now + 60_000,
        updated_at: now,
      }])),
  });

  assert.equal(result.linked_verified_seen, 20);
  assert.equal(result.fresh_queued, 10);
  assert.equal(result.candidates.length, 10);
  assert.equal(result.candidates.every((candidate) => candidate.id.startsWith('fresh-')), true);
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

test('ingestPaginatedCandidates does not reset source cursors on short composite page', async () => {
  class ShortPageSource implements ListSource, SourceCursorListSource {
    readonly sourceId = 'composite';
    readonly sourceType = 'composite_list' as const;
    private offsets = new Map([['A:c1', 100]]);
    private exhausted = new Set<string>();

    listSourceKeys(): string[] {
      return ['A:c1'];
    }

    readSourceOffsets(): ReadonlyMap<string, number> {
      return this.offsets;
    }

    writeSourceOffsets(offsets: Map<string, number>): void {
      this.offsets = new Map(offsets);
      this.exhausted.clear();
    }

    resetAllSourceOffsets(): void {
      this.offsets.set('A:c1', 0);
      this.exhausted.clear();
    }

    areAllSourcesExhausted(): boolean {
      return this.exhausted.has('A:c1');
    }

    async candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]> {
      const start = this.offsets.get('A:c1') ?? 0;
      const page = [movie(`at-${start}`)];
      this.offsets.set('A:c1', start + page.length);
      if (page.length < options.limit) {
        this.exhausted.add('A:c1');
      }
      return page;
    }
  }

  const source = new ShortPageSource();
  const result = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 1,
    pageSize: 10,
    maxScanned: 50,
    sourceOffsets: new Map([['A:c1', 100]]),
    lookupTitles: async () => new Map(),
  });

  assert.equal(result.catalog_exhausted, false);
  assert.equal(result.fresh_queued, 1);
  assert.equal(source.readSourceOffsets().get('A:c1'), 101);
});

test('ingestPaginatedCandidates marks catalog exhausted when all sources drained', async () => {
  class ExhaustedSource implements ListSource, SourceCursorListSource {
    readonly sourceId = 'composite';
    readonly sourceType = 'composite_list' as const;
    private offsets = new Map([['A:c1', 500]]);

    listSourceKeys(): string[] {
      return ['A:c1'];
    }

    readSourceOffsets(): ReadonlyMap<string, number> {
      return this.offsets;
    }

    writeSourceOffsets(offsets: Map<string, number>): void {
      this.offsets = new Map(offsets);
    }

    resetAllSourceOffsets(): void {
      this.offsets.set('A:c1', 0);
    }

    areAllSourcesExhausted(): boolean {
      return true;
    }

    async candidates(): Promise<CandidateMeta[]> {
      return [];
    }
  }

  const source = new ExhaustedSource();
  const result = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 5,
    pageSize: 10,
    maxScanned: 50,
    sourceOffsets: new Map([['A:c1', 500]]),
    lookupTitles: async () => new Map(),
  });

  assert.equal(result.catalog_exhausted, true);
  assert.equal(result.fresh_queued, 0);
  assert.equal(source.readSourceOffsets().get('A:c1'), 500);
});

test('ingestPaginatedCandidates preserves exhausted source cursor state across batches', async () => {
  class ExhaustOnceSource implements ListSource, SourceCursorListSource {
    readonly sourceId = 'composite';
    readonly sourceType = 'composite_list' as const;
    private offsets = new Map<string, number>();
    private exhausted = false;
    fetches = 0;
    writes = 0;

    listSourceKeys(): string[] {
      return ['A:c1'];
    }

    readSourceOffsets(): ReadonlyMap<string, number> {
      return this.offsets;
    }

    writeSourceOffsets(offsets: Map<string, number>): void {
      this.writes += 1;
      this.offsets = new Map(offsets);
      this.exhausted = false;
    }

    resetAllSourceOffsets(): void {
      this.offsets.set('A:c1', 0);
      this.exhausted = false;
    }

    areAllSourcesExhausted(): boolean {
      return this.exhausted;
    }

    async candidates(): Promise<CandidateMeta[]> {
      this.fetches += 1;
      this.exhausted = true;
      return [];
    }
  }

  const source = new ExhaustOnceSource();
  const offsets = new Map([['A:c1', 500]]);
  const first = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 5,
    pageSize: 10,
    maxScanned: 50,
    sourceOffsets: offsets,
    lookupTitles: async () => new Map(),
  });
  const second = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 5,
    pageSize: 10,
    maxScanned: 50,
    sourceOffsets: offsets,
    lookupTitles: async () => new Map(),
  });

  assert.equal(first.catalog_exhausted, true);
  assert.equal(second.catalog_exhausted, true);
  assert.equal(source.fetches, 1);
  assert.equal(source.writes, 1);
});

test('ingestPaginatedCandidates only bypasses tombstoned no_stream when explicitly requested', async () => {
  const source = new MockListSource([
    [movie('retry-me')],
  ]);
  const now = Date.now();

  const result = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 1,
    pageSize: 10,
    maxScanned: 10,
    now,
    bypassRecentFailedReasons: new Set(['no_stream']),
    lookupTitles: async () => new Map([
      ['movie:retry-me', {
        type: 'movie',
        id: 'retry-me',
        status: 'failed',
        fail_reason: 'no_stream',
        expires_at: null,
        updated_at: now - 1000,
      }],
    ]),
  });

  assert.equal(result.fresh_queued, 1);
  assert.equal(result.skipped_recent_failed, 0);
  assert.equal(result.candidates[0]?.id, 'retry-me');
});

test('ingestPaginatedCandidates skips recent no_stream without explicit bypass', async () => {
  const source = new MockListSource([
    [movie('skip-me')],
  ]);
  const now = Date.now();

  const result = await ingestPaginatedCandidates(source, {
    startOffset: 0,
    freshTarget: 1,
    pageSize: 10,
    maxScanned: 10,
    now,
    lookupTitles: async () => new Map([
      ['movie:skip-me', {
        type: 'movie',
        id: 'skip-me',
        status: 'failed',
        fail_reason: 'no_stream',
        expires_at: null,
        updated_at: now - 1000,
      }],
    ]),
  });

  assert.equal(result.fresh_queued, 0);
  assert.equal(result.skipped_recent_failed, 1);
  assert.equal(result.candidates.length, 0);
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

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CatalogCore } from '../core.js';
import {
  processVerifyQueue,
  type VerifyQueueItem,
} from './pipeline.js';
import {
  createVerificationRequest,
  type PreparedVerifyTitleResult,
  type VerifyTitleResult,
} from './verify.js';

const ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ENV };
  Date.now = ORIGINAL_DATE_NOW;
});

const ORIGINAL_DATE_NOW = Date.now;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(predicate(), true);
}

function queue(count: number): VerifyQueueItem[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `movie:tt-pending-${index}`,
    candidate: {
      type: 'movie',
      id: `tt-pending-${index}`,
      title: `Pending ${index}`,
      source: 'test',
    },
    refs: [{
      railId: 'movies-test',
      index,
      candidate: {
        type: 'movie',
        id: `tt-pending-${index}`,
        title: `Pending ${index}`,
        source: 'test',
      },
    }],
    forceReprobe: true,
  }));
}

function failedResult(id: string): VerifyTitleResult {
  return {
    type: 'movie',
    id,
    ok: false,
    identity_certifiable: false,
    exact_main_win: false,
    status: 'failed',
    reason: 'test_failure',
    attempts: [],
  };
}

function prepared(id: string): PreparedVerifyTitleResult {
  return {
    ok: false,
    type: 'movie',
    id,
    reason: 'test_prepared',
    request: createVerificationRequest('movie', id, { requestId: `req-${id}` }),
    resolve_ms: 0,
    prepare_ms: 0,
    filters: {},
  };
}

test('processVerifyQueue stops draining prepared probes after admission deadline', async () => {
  let now = 1_000;
  Date.now = () => now;
  process.env.MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS = '2000';
  process.env.MANGO_PLAYABILITY_RESOLVE_CONCURRENCY = '3';
  process.env.MANGO_PLAYABILITY_PROBE_CONCURRENCY = '1';

  const firstProbe = deferred<VerifyTitleResult>();
  const verifyCalls: string[] = [];
  const prepareCalls: string[] = [];
  const pendingDepths: number[] = [];

  const run = processVerifyQueue({
    core: {} as CatalogCore,
    queue: queue(3),
    railVerifiedCounts: new Map(),
    railPoolTargets: new Map([['movies-test', 99]]),
    railPoolKeys: new Map(),
    prepareQueueItemForTest: async (queueId, item) => {
      prepareCalls.push(item.candidate.id);
      return {
        queueId,
        item,
        prepared: prepared(item.candidate.id),
      };
    },
    verifyPreparedTitleForTest: async (item) => {
      verifyCalls.push(item.id);
      if (verifyCalls.length === 1) {
        return firstProbe.promise;
      }
      return failedResult(item.id);
    },
    onPendingProbeQueuedForTest: (_prepared, depth) => {
      pendingDepths.push(depth);
    },
  });

  await waitFor(() => prepareCalls.length === 3 && verifyCalls.length === 1 && pendingDepths.includes(2));
  now = 2_001;
  firstProbe.resolve(failedResult(verifyCalls[0]));

  const result = await run;
  assert.equal(result.stopped_reason, 'admission_deadline');
  assert.deepEqual(verifyCalls, ['tt-pending-0']);
  assert.equal(result.failed, 1);
  assert.equal(result.results.length, 1);
});

test('processVerifyQueue stops draining prepared probes when couch becomes active', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-pipeline-couch-'));
  try {
    let now = 1_000;
    Date.now = () => now;
    process.env.MANGO_MAINTENANCE_MODE = '1';
    process.env.MANGO_COUCH_ACTIVITY_STATE = join(dir, 'couch.json');
    process.env.MANGO_COUCH_IDLE_SEC = '1800';
    process.env.MANGO_PLAYABILITY_RESOLVE_CONCURRENCY = '3';
    process.env.MANGO_PLAYABILITY_PROBE_CONCURRENCY = '1';
    delete process.env.MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS;

    const firstProbe = deferred<VerifyTitleResult>();
    const verifyCalls: string[] = [];
    const prepareCalls: string[] = [];
    const pendingDepths: number[] = [];

    const run = processVerifyQueue({
      core: {} as CatalogCore,
      queue: queue(3),
      railVerifiedCounts: new Map(),
      railPoolTargets: new Map([['movies-test', 99]]),
      railPoolKeys: new Map(),
      prepareQueueItemForTest: async (queueId, item) => {
        prepareCalls.push(item.candidate.id);
        return {
          queueId,
          item,
          prepared: prepared(item.candidate.id),
        };
      },
      verifyPreparedTitleForTest: async (item) => {
        verifyCalls.push(item.id);
        if (verifyCalls.length === 1) {
          return firstProbe.promise;
        }
        return failedResult(item.id);
      },
      onPendingProbeQueuedForTest: (_prepared, depth) => {
        pendingDepths.push(depth);
      },
    });

    await waitFor(() => prepareCalls.length === 3 && verifyCalls.length === 1 && pendingDepths.includes(2));
    now = 3_000;
    await writeFile(process.env.MANGO_COUCH_ACTIVITY_STATE, JSON.stringify({ ts: now }));
    firstProbe.resolve(failedResult(verifyCalls[0]));

    const result = await run;
    assert.equal(result.stopped_reason, 'couch_activity');
    assert.deepEqual(verifyCalls, ['tt-pending-0']);
    assert.equal(result.failed, 1);
    assert.equal(result.results.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('processVerifyQueue drains prepared probes normally without stop signal', async () => {
  let now = 1_000;
  Date.now = () => now;
  process.env.MANGO_PLAYABILITY_ADMISSION_DEADLINE_MS = '2000';
  process.env.MANGO_PLAYABILITY_RESOLVE_CONCURRENCY = '3';
  process.env.MANGO_PLAYABILITY_PROBE_CONCURRENCY = '1';

  const verifyCalls: string[] = [];

  const result = await processVerifyQueue({
    core: {} as CatalogCore,
    queue: queue(3),
    railVerifiedCounts: new Map(),
    railPoolTargets: new Map([['movies-test', 99]]),
    railPoolKeys: new Map(),
    prepareQueueItemForTest: async (queueId, item) => ({
      queueId,
      item,
      prepared: prepared(item.candidate.id),
    }),
    verifyPreparedTitleForTest: async (item) => {
      verifyCalls.push(item.id);
      now += 1;
      return failedResult(item.id);
    },
  });

  assert.equal(result.stopped_reason, undefined);
  assert.deepEqual(verifyCalls, ['tt-pending-0', 'tt-pending-1', 'tt-pending-2']);
  assert.equal(result.failed, 3);
  assert.equal(result.results.length, 3);
});

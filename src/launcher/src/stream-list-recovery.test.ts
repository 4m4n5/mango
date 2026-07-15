import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogTimeoutError } from './catalog-errors.js';
import { recoverTimedOutStreamList } from './stream-list-recovery.js';

test('stream-list timeout joins existing resolve exactly once', async () => {
  let initialCalls = 0;
  let joinCalls = 0;
  const result = await recoverTimedOutStreamList(
    async () => {
      initialCalls += 1;
      throw new CatalogTimeoutError();
    },
    async () => {
      joinCalls += 1;
      return { streams: ['dune-1080p'] };
    },
  );
  assert.deepEqual(result, { streams: ['dune-1080p'] });
  assert.equal(initialCalls, 1);
  assert.equal(joinCalls, 1);
});

test('stream-list recovery does not retry non-timeout failures', async () => {
  let joinCalls = 0;
  await assert.rejects(
    recoverTimedOutStreamList(
      async () => {
        throw new Error('catalog unavailable');
      },
      async () => {
        joinCalls += 1;
        return { streams: [] };
      },
    ),
    /catalog unavailable/,
  );
  assert.equal(joinCalls, 0);
});

test('stream-list recovery returns immediate success without a late join', async () => {
  let joinCalls = 0;
  const result = await recoverTimedOutStreamList(
    async () => ({ streams: ['the-martian-4k'] }),
    async () => {
      joinCalls += 1;
      return { streams: [] };
    },
  );
  assert.deepEqual(result, { streams: ['the-martian-4k'] });
  assert.equal(joinCalls, 0);
});

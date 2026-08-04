import assert from 'node:assert/strict';
import test from 'node:test';
import { pickForYouDisplayWindow } from './service.js';

test('For You display window stays full and rotates on reshuffle', () => {
  const eligible = Array.from({ length: 40 }, (_, index) => ({
    content_id: `tt${index}`,
    year: String(1980 + (index % 8) * 5),
  }));
  const head = pickForYouDisplayWindow(eligible, {
    limit: 6,
    seed: 'movies:2026-08-02:0',
    reshuffle: false,
  });
  assert.equal(head.length, 6);
  assert.deepEqual(head.map((row) => row.content_id), eligible.slice(0, 6).map((row) => row.content_id));

  const shuffled = pickForYouDisplayWindow(eligible, {
    limit: 6,
    seed: 'movies:2026-08-02:1',
    reshuffle: true,
  });
  assert.equal(shuffled.length, 6);
  assert.equal(new Set(shuffled.map((row) => row.content_id)).size, 6);
  assert.notDeepEqual(
    shuffled.map((row) => row.content_id),
    head.map((row) => row.content_id),
  );
});

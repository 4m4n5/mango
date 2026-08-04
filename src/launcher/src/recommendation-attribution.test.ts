import assert from 'node:assert/strict';
import test from 'node:test';
import { notInterestedCard } from './catalog.js';
import { recommendationAttributionPayload } from './recommendation-attribution.js';

const owner = { profileId: 'alice', personalizationUpdatedAt: 17 };

test('ordinary rail metadata does not turn a mutation into recommendation attribution', () => {
  assert.deepEqual(recommendationAttributionPayload({ railId: 'popular' }), {});
});

test('complete recommendation proof is propagated unchanged', () => {
  assert.deepEqual(recommendationAttributionPayload({
    attributionToken: 'opaque-token',
    railId: 'for-you-movies',
    slateSequence: 7,
  }), {
    attribution_token: 'opaque-token',
    rail_id: 'for-you-movies',
    slate_revision: 7,
  });
});

test('incomplete recommendation proof is preserved so the service can reject it', () => {
  assert.deepEqual(recommendationAttributionPayload({
    attributionToken: 'opaque-token',
    railId: 'for-you-movies',
  }), {
    attribution_token: 'opaque-token',
    rail_id: 'for-you-movies',
  });
});

test('ordinary Not for me does not send display-only rail metadata as proof', async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      ok: true,
      profile_id: 'alice',
      personalization_updated_at: 17,
    }), { status: 200 });
  };
  try {
    await notInterestedCard({
      id: 'tt-one', type: 'movie', title: 'One', subtitle: '2026', railId: 'popular-movies',
    }, 'movies', owner);
    assert.equal(body?.rail_id, undefined);
    assert.equal(body?.attribution_token, undefined);
    assert.equal(body?.slate_revision, undefined);
    assert.equal(body?.expected_profile_id, 'alice');
    assert.equal(body?.expected_personalization_updated_at, 17);
  } finally {
    globalThis.fetch = original;
  }
});

test('recommended Not for me sends the complete immutable proof tuple', async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      ok: true,
      profile_id: 'alice',
      personalization_updated_at: 17,
    }), { status: 200 });
  };
  try {
    await notInterestedCard({
      id: 'tt-one',
      type: 'movie',
      title: 'One',
      subtitle: '2026',
      railId: 'for-you-movies',
      attributionToken: 'opaque-token',
      slateSequence: 9,
    }, 'movies', owner);
    assert.deepEqual({
      attribution_token: body?.attribution_token,
      rail_id: body?.rail_id,
      slate_revision: body?.slate_revision,
    }, {
      attribution_token: 'opaque-token',
      rail_id: 'for-you-movies',
      slate_revision: 9,
    });
  } finally {
    globalThis.fetch = original;
  }
});

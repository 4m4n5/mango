import assert from 'node:assert/strict';
import test from 'node:test';
import { notInterestedCard, playCard } from './catalog.js';
import {
  playbackRecommendationFields,
  recommendationAttributionPayload,
} from './recommendation-attribution.js';

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

function playingSessionResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    profile_id: 'alice',
    personalization_updated_at: 17,
    session: {
      session_id: 'session-one',
      version: 1,
      state: 'playing',
      ever_ready: true,
      error: null,
      result: { ok: true },
    },
  }), { status: 202 });
}

test('Search YouTube play keeps the display rail and does not claim a served slate', () => {
  assert.deepEqual(playbackRecommendationFields({
    id: 'dQw4w9wgGcQ',
    type: 'youtube_video',
    railId: 'search:youtube',
  }), {
    rail_id: 'search:youtube',
  });
});

test('YouTube rail play sends the complete served-slate tuple', () => {
  assert.deepEqual(playbackRecommendationFields({
    id: 'dQw4w9wgGcQ',
    type: 'youtube_video',
    railId: 'because_you_watched',
    slateSequence: 22,
    attributionToken: 'opaque-token',
  }), {
    rail_id: 'because_you_watched',
    slate_revision: 22,
    attribution_token: 'opaque-token',
    recommendation_item_type: 'youtube_video',
    recommendation_item_id: 'dQw4w9wgGcQ',
  });
});

test('Search YouTube playCard does not send recommendation identity', async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return playingSessionResponse();
  };
  try {
    assert.equal((await playCard({
      id: 'dQw4w9wgGcQ',
      type: 'youtube_video',
      title: 'Never Gonna Give You Up',
      subtitle: 'Rick Astley',
      source: 'youtube',
      railId: 'search:youtube',
    }, { expectedOwner: owner })).ok, true);
    assert.equal(body?.source, 'youtube');
    assert.equal(body?.rail_id, 'search:youtube');
    assert.equal(body?.recommendation_item_type, undefined);
    assert.equal(body?.recommendation_item_id, undefined);
    assert.equal(body?.attribution_token, undefined);
    assert.equal(body?.slate_revision, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('YouTube tab playCard sends served-slate proof when the rail issued a token', async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return playingSessionResponse();
  };
  try {
    assert.equal((await playCard({
      id: 'dQw4w9wgGcQ',
      type: 'youtube_video',
      title: 'Never Gonna Give You Up',
      subtitle: 'Rick Astley',
      source: 'youtube',
      railId: 'because_you_watched',
      slateSequence: 22,
      attributionToken: 'opaque-token',
    }, { expectedOwner: owner })).ok, true);
    assert.deepEqual({
      recommendation_item_type: body?.recommendation_item_type,
      recommendation_item_id: body?.recommendation_item_id,
      attribution_token: body?.attribution_token,
      slate_revision: body?.slate_revision,
      rail_id: body?.rail_id,
    }, {
      recommendation_item_type: 'youtube_video',
      recommendation_item_id: 'dQw4w9wgGcQ',
      attribution_token: 'opaque-token',
      slate_revision: 22,
      rail_id: 'because_you_watched',
    });
  } finally {
    globalThis.fetch = original;
  }
});

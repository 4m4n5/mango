import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogTabLoadPolicy,
  mergeUserStateRails,
  RecommendationTabRevisionFence,
  vodDiscoveryShufflePolicy,
  vodUtilityHouseholdBlend,
  vodUtilityProfileId,
  type RailItemsResponse,
} from './core.js';

function rail(id: string, count: number): RailItemsResponse {
  return {
    rail_id: id,
    label: id,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${id}-${index}`,
      type: 'movie',
      title: `${id} ${index}`,
      subtitle: 'movie',
      poster: '',
      source: id,
    })),
    resolve_ms: 0,
    skipped: 0,
    playability: {
      displayed: count,
      verified_pool: count,
      pending: 0,
      low_water: false,
      session_id: 'test',
    },
  };
}

test('Saved rail is inserted immediately after Continue before discovery rails', () => {
  const ordered = mergeUserStateRails(
    [rail('discover-a', 2), rail('empty', 0), rail('discover-b', 1)],
    rail('continue-watching', 1),
    rail('saved', 2),
  );
  assert.deepEqual(ordered.map((entry) => entry.rail_id), [
    'continue-watching',
    'saved',
    'discover-a',
    'discover-b',
  ]);
});

test('For You is system-owned after Continue and Saved without consuming discovery order', () => {
  const ordered = mergeUserStateRails(
    [rail('ai-slot-1', 1), rail('discover', 1)],
    rail('continue-watching', 1),
    rail('saved', 1),
    { forYouRail: rail('for-you-movies', 12) },
  );
  assert.deepEqual(ordered.map((entry) => entry.rail_id), [
    'continue-watching',
    'saved',
    'for-you-movies',
    'ai-slot-1',
    'discover',
  ]);
});

test('Saved rail appears first when Continue is empty and is absent when empty', () => {
  assert.deepEqual(
    mergeUserStateRails([rail('discover', 1)], rail('continue-watching', 0), rail('saved', 1))
      .map((entry) => entry.rail_id),
    ['saved', 'discover'],
  );
  assert.deepEqual(
    mergeUserStateRails([rail('discover', 1)], rail('continue-watching', 0), rail('saved', 0))
      .map((entry) => entry.rail_id),
    ['discover'],
  );
});

function userStateIds(
  continueCount: number,
  savedCount: number,
): { continueIds: string[]; savedIds: string[] } {
  const merged = mergeUserStateRails(
    [rail('discover', 1)],
    rail('continue-watching', continueCount),
    rail('saved', savedCount),
  );
  const byId = (id: string) => merged.find((entry) => entry.rail_id === id)?.items.map((i) => i.id) ?? [];
  return { continueIds: byId('continue-watching'), savedIds: byId('saved') };
}

test('user-state rails keep source order when no reshuffle was requested', () => {
  const { continueIds, savedIds } = userStateIds(9, 9);
  assert.deepEqual(continueIds, Array.from({ length: 9 }, (_, i) => `continue-watching-${i}`));
  assert.deepEqual(savedIds, Array.from({ length: 9 }, (_, i) => `saved-${i}`));
});

test('Home shuffle leaves chronological Continue and Saved rails stable', () => {
  for (const count of [6, 9, 20]) {
    const { continueIds, savedIds } = userStateIds(count, count);
    assert.deepEqual(continueIds, Array.from({ length: count }, (_, i) => `continue-watching-${i}`));
    assert.deepEqual(savedIds, Array.from({ length: count }, (_, i) => `saved-${i}`));
  }
});

test('X does not rotate the global session or start metadata warming', () => {
  assert.deepEqual(catalogTabLoadPolicy(true, 99_999, 1), {
    rotatePlayabilitySession: false,
    warmMetadata: false,
  });
  assert.equal(catalogTabLoadPolicy(false, 10, 100).rotatePlayabilitySession, false);
  assert.equal(catalogTabLoadPolicy(false, 100, 100).rotatePlayabilitySession, true);
});

test('X deals every VOD category rail from cached pools and prefers unseen titles', () => {
  assert.deepEqual(vodDiscoveryShufflePolicy('movies', true), {
    forceCuratedReshuffle: true,
    stableRatio: 1,
    cachedOnly: true,
  });
  assert.deepEqual(vodDiscoveryShufflePolicy('series', true), {
    forceCuratedReshuffle: true,
    stableRatio: 1,
    cachedOnly: true,
  });
  assert.deepEqual(vodDiscoveryShufflePolicy('movies', false), {
    forceCuratedReshuffle: false,
    cachedOnly: false,
  });
  assert.deepEqual(vodDiscoveryShufflePolicy('youtube', true), {
    forceCuratedReshuffle: false,
    cachedOnly: false,
  });
});

test('recommendation revision fences are independent per VOD media type', () => {
  const fence = new RecommendationTabRevisionFence();
  const movies = fence.capture('movies');
  const series = fence.capture('series');
  fence.bump('movies');
  assert.equal(fence.isCurrent('movies', movies), false);
  assert.equal(fence.isCurrent('series', series), true);
});

test('active recommendation modes bind VOD utility rails to exact Household', () => {
  assert.equal(vodUtilityProfileId('movies', 'personal-only', 'serve'), 'household');
  assert.equal(vodUtilityProfileId('series', 'personal-only', 'serve'), 'household');
  assert.equal(vodUtilityProfileId('movies', 'personal-only', 'shadow'), 'household');
  assert.equal(vodUtilityProfileId('movies', 'personal-only', 'off'), 'personal-only');
  assert.equal(vodUtilityProfileId('live', 'personal-only', 'serve'), 'personal-only');
  assert.equal(vodUtilityHouseholdBlend('movies', 'household', 'serve'), false);
  assert.equal(vodUtilityHouseholdBlend('movies', 'household', 'shadow'), false);
  assert.equal(vodUtilityHouseholdBlend('movies', 'personal-only', 'off'), true);
  assert.equal(vodUtilityHouseholdBlend('live', 'household', 'serve'), true);
});

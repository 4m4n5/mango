import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeUserStateRails, type RailItemsResponse } from './core.js';

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
  reshuffle: boolean,
): { continueIds: string[]; savedIds: string[] } {
  const merged = mergeUserStateRails(
    [rail('discover', 1)],
    rail('continue-watching', continueCount),
    rail('saved', savedCount),
    { reshuffle },
  );
  const byId = (id: string) => merged.find((entry) => entry.rail_id === id)?.items.map((i) => i.id) ?? [];
  return { continueIds: byId('continue-watching'), savedIds: byId('saved') };
}

test('user-state rails keep source order when no reshuffle was requested', () => {
  const { continueIds, savedIds } = userStateIds(9, 9, false);
  assert.deepEqual(continueIds, Array.from({ length: 9 }, (_, i) => `continue-watching-${i}`));
  assert.deepEqual(savedIds, Array.from({ length: 9 }, (_, i) => `saved-${i}`));
});

test('reshuffle leaves user-state rails alone when they fit inside one visible row', () => {
  // Six items are all on screen already, so reordering them would be churn with
  // nothing new surfaced — and for Continue it would reorder the resume queue.
  const { continueIds, savedIds } = userStateIds(6, 6, true);
  assert.deepEqual(continueIds, Array.from({ length: 6 }, (_, i) => `continue-watching-${i}`));
  assert.deepEqual(savedIds, Array.from({ length: 6 }, (_, i) => `saved-${i}`));
});

test('reshuffle pins the most recent Continue item and never drops a title', () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { continueIds, savedIds } = userStateIds(9, 9, true);
    assert.equal(continueIds[0], 'continue-watching-0', 'most recent resume must stay in slot one');
    assert.deepEqual(
      [...continueIds].sort(),
      Array.from({ length: 9 }, (_, i) => `continue-watching-${i}`).sort(),
    );
    assert.deepEqual(
      [...savedIds].sort(),
      Array.from({ length: 9 }, (_, i) => `saved-${i}`).sort(),
    );
  }
});

test('reshuffle actually reorders both user-state rails', () => {
  // 9 items give 8!/9! orderings; identical output across 50 draws is not a
  // realistic outcome, so a single differing draw is enough to prove movement.
  let continueMoved = false;
  let savedMoved = false;
  for (let attempt = 0; attempt < 50 && !(continueMoved && savedMoved); attempt += 1) {
    const { continueIds, savedIds } = userStateIds(9, 9, true);
    if (continueIds.slice(1).some((id, index) => id !== `continue-watching-${index + 1}`)) {
      continueMoved = true;
    }
    if (savedIds.some((id, index) => id !== `saved-${index}`)) {
      savedMoved = true;
    }
  }
  assert.ok(continueMoved, 'Continue tail should rotate');
  assert.ok(savedMoved, 'Saved should rotate');
});


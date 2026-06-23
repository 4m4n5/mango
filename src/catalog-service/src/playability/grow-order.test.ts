import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayableRail } from '../core.js';
import { railsForGrowPass } from './grow-order.js';

function rail(
  id: string,
  type: string,
  poolTarget = 20,
  verified = 0,
): PlayableRail {
  return {
    id,
    type,
    playability: { pool_target: poolTarget },
  } as PlayableRail;
}

test('railsForGrowPass processes browse rails before ai catalog slots', () => {
  const ordered = railsForGrowPass([
    rail('ai-horror', 'ai_catalog'),
    rail('movies-global-popular', 'composite_list'),
    rail('ai-comedy', 'ai_catalog'),
    rail('series-classics', 'composite_list'),
  ]);

  assert.deepEqual(ordered.map((entry) => entry.id), [
    'movies-global-popular',
    'series-classics',
    'ai-horror',
    'ai-comedy',
  ]);
});

test('railsForGrowPass sorts browse rails by fill ratio ascending', () => {
  const rails = [
    rail('movies-global-popular', 'composite_list', 20, 0),
    rail('movies-india-trending', 'composite_list', 20, 0),
    rail('movies-classics', 'composite_list', 20, 0),
    rail('ai-slot', 'ai_catalog'),
  ];
  const verified = new Map<string, number>([
    ['movies-global-popular', 40],
    ['movies-india-trending', 8],
    ['movies-classics', 4],
  ]);

  const ordered = railsForGrowPass(rails, { verifiedPoolByRail: verified });
  assert.deepEqual(ordered.map((entry) => entry.id), [
    'movies-classics',
    'movies-india-trending',
    'movies-global-popular',
    'ai-slot',
  ]);
});

test('railsForGrowPass deprioritizes anchor rails at equal fill ratio', () => {
  const rails = [
    rail('movies-global-popular', 'composite_list', 20),
    rail('movies-comedy', 'composite_list', 20),
  ];
  const verified = new Map<string, number>([
    ['movies-global-popular', 10],
    ['movies-comedy', 10],
  ]);

  const ordered = railsForGrowPass(rails, { verifiedPoolByRail: verified });
  assert.deepEqual(ordered.map((entry) => entry.id), [
    'movies-comedy',
    'movies-global-popular',
  ]);
});

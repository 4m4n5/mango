import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayableRail } from '../core.js';
import { railsForGrowPass } from './grow-order.js';

function rail(id: string, type: string): PlayableRail {
  return { id, type } as PlayableRail;
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

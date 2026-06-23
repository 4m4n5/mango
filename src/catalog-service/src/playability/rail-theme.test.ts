import assert from 'node:assert/strict';
import test from 'node:test';
import type { Meta } from '../core.js';
import {
  metaHaystack,
  parseRuntimeMinutes,
  scoreThematicFit,
  type RailThemeProfile,
} from './rail-theme.js';
import { tokenizeIntent } from '../ai-catalogs/compose.js';

function profile(
  railId: string,
  intent: string,
  exclude = '',
  minFit = 8,
  maxRuntime?: number,
): RailThemeProfile {
  return {
    rail_id: railId,
    intent,
    exclude,
    intent_tags: tokenizeIntent(intent),
    exclude_tags: tokenizeIntent(exclude),
    min_fit: minFit,
    max_runtime_minutes: maxRuntime,
  };
}

test('metaHaystack merges title and genres', () => {
  const haystack = metaHaystack(
    {
      id: 'tt1',
      type: 'series',
      name: 'The Amazing Race',
      genre: 'Reality-TV',
      description: 'Teams race around the world.',
    } as Meta,
    'The Amazing Race',
  );
  assert.match(haystack, /reality/);
  assert.match(haystack, /amazing race/);
});

test('scoreThematicFit rewards reality keywords on reality rail', () => {
  const reality = profile(
    'series-reality-casual',
    'reality game show competition dating survivor bachelor',
    'drama sitcom scripted fiction',
  );
  const comedy = profile('series-comedy', 'comedy sitcom funny humor');
  const frasierHaystack = 'frasier sitcom comedy psychiatrist seattle';
  const survivorHaystack = 'survivor reality competition island';

  assert.ok(scoreThematicFit(survivorHaystack, reality) >= reality.min_fit);
  assert.ok(scoreThematicFit(frasierHaystack, comedy) >= comedy.min_fit);
  assert.ok(scoreThematicFit(frasierHaystack, reality) < reality.min_fit);
});

test('scoreThematicFit rejects western blockbuster on india movie rail', () => {
  const india = profile(
    'movies-india-trending',
    'hindi bollywood tamil telugu malayalam kannada bengali marathi punjabi indian cinema desi',
    'hollywood american british korean japanese french german spanish',
    14,
  );
  const duneHaystack = 'dune part two science fiction epic american blockbuster timothee chalamet';
  const rrHaystack = 'rrr telugu indian action drama rajamouli';
  assert.ok(scoreThematicFit(rrHaystack, india) >= india.min_fit);
  assert.ok(scoreThematicFit(duneHaystack, india) < india.min_fit);
});

test('scoreThematicFit penalizes long runtime on quick-watches', () => {
  const quick = profile(
    'movies-quick-watches',
    'stand-up comedy special short quick easy light',
    'documentary epic miniseries',
    8,
    110,
  );
  const shortHaystack = 'stand-up comedy special hour';
  const longHaystack = 'epic war drama';
  const shortScore = scoreThematicFit(shortHaystack, quick, 95);
  const longScore = scoreThematicFit(longHaystack, quick, 180);
  assert.ok(shortScore > longScore);
});

test('parseRuntimeMinutes handles hours and minutes', () => {
  assert.equal(parseRuntimeMinutes({ id: 'tt1', type: 'movie', runtime: '2h 15m' } as Meta), 135);
  assert.equal(parseRuntimeMinutes({ id: 'tt2', type: 'movie', runtimeMinutes: 92 } as Meta), 92);
});

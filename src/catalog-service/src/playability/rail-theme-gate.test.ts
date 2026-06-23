import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenizeIntent } from '../ai-catalogs/compose.js';
import {
  RailThemeGate,
  themeGateEnabled,
} from './rail-theme-gate.js';
import type { RailThemeProfile } from './rail-theme.js';
import { parseRailCurationOverrides } from './rail-overrides.js';

function profile(
  railId: string,
  intent: string,
  exclude = '',
  minFit = 8,
): RailThemeProfile {
  return {
    rail_id: railId,
    intent,
    exclude,
    intent_tags: tokenizeIntent(intent),
    exclude_tags: tokenizeIntent(exclude),
    min_fit: minFit,
  };
}

test('themeGateEnabled defaults on unless env disables', () => {
  const prev = process.env.MANGO_RAIL_THEME_GATE;
  delete process.env.MANGO_RAIL_THEME_GATE;
  assert.equal(themeGateEnabled(), true);
  process.env.MANGO_RAIL_THEME_GATE = '0';
  assert.equal(themeGateEnabled(), false);
  if (prev === undefined) delete process.env.MANGO_RAIL_THEME_GATE;
  else process.env.MANGO_RAIL_THEME_GATE = prev;
});

test('scoreTitleOnly rejects western title on india rail', () => {
  const gate = RailThemeGate.forTest(
    new Map([
      ['movies-india-trending', profile(
        'movies-india-trending',
        'hindi bollywood tamil telugu indian cinema desi',
        'hollywood american british',
        14,
      )],
    ]),
    parseRailCurationOverrides('version: 1\npins: []\nblocks: []'),
  );
  const dune = gate.scoreTitleOnly('movies-india-trending', {
    type: 'movie',
    id: 'tt15239678',
    title: 'Dune: Part Two',
  });
  assert.equal(dune.fit, false);
  const rrr = gate.scoreTitleOnly('movies-india-trending', {
    type: 'movie',
    id: 'tt8178634',
    title: 'RRR telugu indian epic',
  });
  assert.equal(rrr.fit, true);
});

test('scoreTitleOnly allows anchor rails broadly', () => {
  const gate = RailThemeGate.forTest(
    new Map([
      ['movies-global-popular', profile('movies-global-popular', 'popular mainstream', '', 3)],
    ]),
    parseRailCurationOverrides('version: 1\npins: []\nblocks: []'),
  );
  const fit = gate.scoreTitleOnly('movies-global-popular', {
    type: 'movie',
    id: 'tt1',
    title: 'Random Film',
  });
  assert.equal(fit.fit, true);
  assert.equal(fit.reason, 'anchor');
});

test('shouldSkipProbe skips clear exclude matches', () => {
  const gate = RailThemeGate.forTest(
    new Map([
      ['series-reality-casual', profile(
        'series-reality-casual',
        'reality game show competition',
        'sitcom drama scripted fiction',
        8,
      )],
    ]),
    parseRailCurationOverrides('version: 1\npins: []\nblocks: []'),
  );
  assert.equal(
    gate.shouldSkipProbe('series-reality-casual', {
      type: 'series',
      id: 'tt1234',
      title: 'Frasier sitcom',
    }),
    true,
  );
});

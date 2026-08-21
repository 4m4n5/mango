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

test('scoreTitleOnly uses source name evidence without admitting generic series sources', () => {
  const gate = RailThemeGate.forTest(
    new Map([
      ['series-miniseries', profile(
        'series-miniseries',
        'miniseries limited series anthology finite season',
        'reality soap opera',
        8,
      )],
    ]),
    parseRailCurationOverrides('version: 1\npins: []\nblocks: []'),
  );

  const explicit = gate.scoreTitleOnly('series-miniseries', {
    type: 'series',
    id: 'tt1',
    title: 'Unknown Title',
    source_name: 'Top Miniseries',
  });
  assert.equal(explicit.fit, true);

  const generic = gate.scoreTitleOnly('series-miniseries', {
    type: 'series',
    id: 'tt2',
    title: 'Unknown Title',
    source_name: 'HBO Shows',
  });
  assert.equal(generic.fit, false);
});

test('scoreTitleOnly uses Indian web-series source evidence for India series rail', () => {
  const gate = RailThemeGate.forTest(
    new Map([
      ['series-india-picks', profile(
        'series-india-picks',
        'india hindi bollywood tamil telugu malayalam kannada desi hotstar zee sonyliv voot jio panchayat sacred games',
        'hollywood american british korean japanese anime french german spanish hbo worldwide western european',
        10,
      )],
    ]),
    parseRailCurationOverrides('version: 1\npins: []\nblocks: []'),
  );

  const fit = gate.scoreTitleOnly('series-india-picks', {
    type: 'series',
    id: 'tt1',
    title: 'Unknown Title',
    source_name: 'Indian Web Series',
  });
  assert.equal(fit.fit, true);
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

test('shouldSkipProbe does not skip low-information regional titles before meta', () => {
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

  assert.equal(
    gate.shouldSkipProbe('movies-india-trending', {
      type: 'movie',
      id: 'tt27940442',
      title: 'Ground Zero',
    }),
    false,
  );
});

test('fitsRail does not treat Indian Territory as Indian cinema', async () => {
  const profileMap = new Map([
    ['movies-india-trending', profile(
      'movies-india-trending',
      'india hindi bollywood tamil telugu malayalam kannada desi',
      'hollywood american british',
      10,
    )],
  ]);
  const gate = RailThemeGate.forTest(
    profileMap,
    parseRailCurationOverrides('version: 1\npins: []\nblocks: []'),
    {
      meta: async () => ({
        id: 'tt31727267',
        type: 'movie',
        name: "Sarah's Oil",
        description: 'A young girl in Indian Territory discovers oil and fights for her future.',
        country: 'United States',
        genres: ['Drama'],
      }),
    } as never,
  );

  const fit = await gate.fitsRail('movies-india-trending', {
    type: 'movie',
    id: 'tt31727267',
    title: "Sarah's Oil",
  });
  assert.equal(fit.fit, false);
});

test('fitsRail accepts regional movie metadata with language and country signals', async () => {
  const profileMap = new Map([
    ['movies-india-trending', profile(
      'movies-india-trending',
      'india hindi bollywood tamil telugu malayalam kannada desi',
      'hollywood american british',
      10,
    )],
  ]);
  const gate = RailThemeGate.forTest(
    profileMap,
    parseRailCurationOverrides('version: 1\npins: []\nblocks: []'),
    {
      meta: async () => ({
        id: 'tt0422091',
        type: 'movie',
        name: 'Dhoom',
        country: 'India',
        languages: ['Hindi'],
        genres: ['Action'],
      }),
    } as never,
  );

  const fit = await gate.fitsRail('movies-india-trending', {
    type: 'movie',
    id: 'tt0422091',
    title: 'Dhoom',
  });
  assert.equal(fit.fit, true);
});

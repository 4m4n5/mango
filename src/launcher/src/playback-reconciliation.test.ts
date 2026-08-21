import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayTimeoutError } from './catalog-errors';
import { reconcileEpisodePlayTimeout } from './playback-reconciliation';
import type { SeriesEpisodesResponse } from './catalog';

function response(overrides: {
  playable?: boolean | null;
  status?: string | null;
  updatedAt?: number | null;
} = {}): SeriesEpisodesResponse {
  return {
    series_id: 'tt12004706',
    name: 'Panchayat',
    seasons: [{
      season: 2,
      label: 'Season 2',
      episodes: [{
        id: 'tt12004706:2:4',
        season: 2,
        episode: 4,
        title: 'Episode 4',
        progress_pct: null,
        playable: overrides.playable ?? true,
        playability_status: overrides.status ?? 'verified',
        playability_updated_at: overrides.updatedAt ?? 1_100,
      }],
    }],
    resume: null,
    episode_count: 1,
    default_episode_id: 'tt12004706:2:4',
  };
}

test('fresh server-confirmed playback suppresses timeout grey/toast reconciliation', async () => {
  assert.equal(await reconcileEpisodePlayTimeout(
    new PlayTimeoutError(true),
    'tt12004706:2:4',
    1_000,
    async () => response(),
  ), true);
});

test('genuine pre-playback abort remains a visible retry failure', async () => {
  let loads = 0;
  assert.equal(await reconcileEpisodePlayTimeout(
    new PlayTimeoutError(false),
    'tt12004706:2:4',
    1_000,
    async () => {
      loads += 1;
      return response();
    },
  ), false);
  assert.equal(loads, 0);
});

test('stale or failed episode state cannot prove this playback attempt', async () => {
  assert.equal(await reconcileEpisodePlayTimeout(
    new PlayTimeoutError(true),
    'tt12004706:2:4',
    1_000,
    async () => response({ updatedAt: 999 }),
  ), false);
  assert.equal(await reconcileEpisodePlayTimeout(
    new PlayTimeoutError(true),
    'tt12004706:2:4',
    1_000,
    async () => response({ playable: false, status: 'failed', updatedAt: 1_100 }),
  ), false);
});

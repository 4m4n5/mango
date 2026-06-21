import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupplementalMetaEpisode,
  nextEpisodeId,
  normalizeSeriesEpisodes,
  applyEpisodeProgress,
  applyEpisodePlayability,
} from './episodes.js';
import { resolveSeriesPlayTarget } from './series-play.js';

const CHERNOBYL_VIDEOS = [
  { id: 'tt7366338:0:23', season: 0, episode: 23, title: 'Inside the Episode - 1:23:45' },
  { id: 'tt7366338:1:1', season: 1, episode: 1, title: '1:23:45' },
  { id: 'tt7366338:1:2', season: 1, episode: 2, title: 'Please Remain Calm' },
  { id: 'tt7366338:1:5', season: 1, episode: 5, title: 'Vichnaya Pamyat' },
];

const PANCHAYAT_VIDEOS = [
  { id: 'tt12004706:1:1', season: 1, episode: 1, title: 'Gram Panchayat Phulera' },
  { id: 'tt12004706:1:2', season: 1, episode: 2, title: 'Ladka Ka Tohfa' },
  { id: 'tt12004706:2:1', season: 2, episode: 1, title: 'Naach' },
];

test('isSupplementalMetaEpisode drops season 0 and BTS titles', () => {
  assert.equal(isSupplementalMetaEpisode(CHERNOBYL_VIDEOS[0]), true);
  assert.equal(isSupplementalMetaEpisode(CHERNOBYL_VIDEOS[1]), false);
});

test('normalizeSeriesEpisodes filters extras and groups seasons', () => {
  const chernobyl = normalizeSeriesEpisodes('tt7366338', CHERNOBYL_VIDEOS);
  assert.equal(chernobyl.seasons.length, 1);
  assert.equal(chernobyl.seasons[0]?.episodes.length, 3);

  const panchayat = normalizeSeriesEpisodes('tt12004706', PANCHAYAT_VIDEOS);
  assert.equal(panchayat.seasons.length, 2);
  assert.equal(panchayat.seasons[0]?.episodes.length, 2);
  assert.equal(panchayat.seasons[1]?.episodes[0]?.id, 'tt12004706:2:1');
});

test('applyEpisodeProgress marks saved episode row', () => {
  const { seasons } = normalizeSeriesEpisodes('tt12004706', PANCHAYAT_VIDEOS);
  applyEpisodeProgress(seasons, {
    progress_key: 'series:tt12004706',
    type: 'series',
    id: 'tt12004706',
    play_id: 'tt12004706:2:1',
    title: 'Panchayat',
    poster: null,
    position_sec: 600,
    duration_sec: 1800,
    progress_pct: 1 / 3,
    updated_at: Date.now(),
  });
  const s2e1 = seasons[1]?.episodes[0];
  assert.equal(s2e1?.progress_pct, 1 / 3);
  assert.equal(seasons[0]?.episodes[0]?.progress_pct, null);
});

test('nextEpisodeId walks flat season order', () => {
  const { seasons } = normalizeSeriesEpisodes('tt12004706', PANCHAYAT_VIDEOS);
  assert.equal(nextEpisodeId(seasons, 'tt12004706:1:1'), 'tt12004706:1:2');
  assert.equal(nextEpisodeId(seasons, 'tt12004706:1:2'), 'tt12004706:2:1');
  assert.equal(nextEpisodeId(seasons, 'tt12004706:2:1'), null);
});

test('applyEpisodePlayability marks verified and failed episodes', () => {
  const { seasons } = normalizeSeriesEpisodes('tt12004706', PANCHAYAT_VIDEOS);
  const now = Date.now();
  applyEpisodePlayability(seasons, new Map([
    ['series:tt12004706:1:1', { status: 'verified', expires_at: now + 60_000 }],
    ['series:tt12004706:1:2', { status: 'failed', expires_at: null }],
  ]));
  assert.equal(seasons[0]?.episodes[0]?.playable, true);
  assert.equal(seasons[0]?.episodes[1]?.playable, false);
  assert.equal(seasons[1]?.episodes[0]?.playable, null);
});

test('resolveSeriesPlayTarget uses latest continue progress for bare id', () => {
  const saved = {
    progress_key: 'series:tt12004706',
    type: 'series',
    id: 'tt12004706',
    play_id: 'tt12004706:2:1',
    title: 'Panchayat',
    poster: null,
    position_sec: 120,
    duration_sec: 1800,
    progress_pct: 120 / 1800,
    updated_at: Date.now(),
  };
  const target = resolveSeriesPlayTarget('series', 'tt12004706', { saved });
  assert.equal(target.playId, 'tt12004706:2:1');
  assert.equal(target.startSec, 120);
  assert.equal(target.resolved_from, 'latest');
});

test('resolveSeriesPlayTarget defaults bare id to S1E1 without progress', () => {
  const target = resolveSeriesPlayTarget('series', 'tt12004706', { saved: null });
  assert.equal(target.playId, 'tt12004706:1:1');
  assert.equal(target.resolved_from, 'default_s1e1');
});

test('resolveSeriesPlayTarget keeps explicit episode id', () => {
  const target = resolveSeriesPlayTarget('series', 'tt12004706:2:3', { saved: null });
  assert.equal(target.playId, 'tt12004706:2:3');
  assert.equal(target.resolved_from, 'explicit');
});

test('resolveSeriesPlayTarget leaves movies unchanged', () => {
  const target = resolveSeriesPlayTarget('movie', 'tt0111161', { saved: null });
  assert.equal(target.playId, 'tt0111161');
});

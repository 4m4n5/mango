import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNextPromptResponse,
  notePlaybackExit,
  resetPendingNextPromptForTests,
  takePendingNextPrompt,
} from './next-prompt.js';
import { normalizeSeriesEpisodes } from '../episodes.js';

test('notePlaybackExit stores series exits once the episode is finished (>=90%)', () => {
  resetPendingNextPromptForTests();
  notePlaybackExit(
    { type: 'series', title_id: 'tt12004706', play_id: 'tt12004706:1:1' },
    1740,
    1800,
  );
  const pending = takePendingNextPrompt();
  assert.ok(pending);
  assert.equal(pending?.episode_id, 'tt12004706:1:1');
  assert.ok((pending?.progress_pct ?? 0) >= 0.9);
});

test('notePlaybackExit ignores movies, and series exits before the finish bar', () => {
  resetPendingNextPromptForTests();
  notePlaybackExit(
    { type: 'movie', title_id: 'tt0111161', play_id: 'tt0111161' },
    1740,
    1800,
  );
  // 50% is mid-watch under the finished-only rule — no prompt.
  notePlaybackExit(
    { type: 'series', title_id: 'tt12004706', play_id: 'tt12004706:1:1' },
    900,
    1800,
  );
  assert.equal(takePendingNextPrompt(), null);
});

test('notePlaybackExit clears stale pending when the same episode later exits mid-watch', () => {
  resetPendingNextPromptForTests();
  notePlaybackExit(
    { type: 'series', title_id: 'tt12004706', play_id: 'tt12004706:1:1' },
    1740,
    1800,
  );
  // Viewer seeked back and quit mid-watch — the earlier finished pending is dropped.
  notePlaybackExit(
    { type: 'series', title_id: 'tt12004706', play_id: 'tt12004706:1:1' },
    600,
    1800,
  );
  assert.equal(takePendingNextPrompt(), null);
});

test('buildNextPromptResponse returns next playable episode', () => {
  const { seasons } = normalizeSeriesEpisodes([
    { id: 'tt12004706:1:1', season: 1, episode: 1, title: 'One' },
    { id: 'tt12004706:1:2', season: 1, episode: 2, title: 'Two' },
  ]);
  const response = buildNextPromptResponse(
    {
      series_id: 'tt12004706',
      episode_id: 'tt12004706:1:1',
      progress_pct: 0.6,
      position_sec: 600,
      duration_sec: 1000,
    },
    seasons,
    'Panchayat',
  );
  assert.equal(response.show, true);
  assert.equal(response.next?.id, 'tt12004706:1:2');
  assert.equal(response.next?.title, 'Two');
});

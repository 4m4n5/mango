import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlaybackHudContext } from './playback-hud-context.js';

test('playback HUD context formats movie, episode, and Live titles without ids', () => {
  assert.deepEqual(buildPlaybackHudContext({
    type: 'movie',
    title: 'Arrival',
    contentId: 'tt2543164',
  }), { title: 'Arrival', kind: 'movie' });
  assert.deepEqual(buildPlaybackHudContext({
    type: 'series',
    title: 'Panchayat',
    contentId: 'tt12004706:2:7',
    episodeTitle: 'Parivaar',
  }), {
    title: 'Panchayat',
    context: 'S2 E7 · Parivaar',
    kind: 'series',
  });
  assert.deepEqual(buildPlaybackHudContext({
    type: 'tv',
    title: 'BBC World News',
    contentId: 'opaque-live-channel-id',
  }), { title: 'BBC World News', kind: 'tv' });
  assert.doesNotMatch(JSON.stringify(buildPlaybackHudContext({
    type: 'series',
    title: 'Panchayat',
    contentId: 'tt12004706:2:7',
  })), /tt12004706/);
});

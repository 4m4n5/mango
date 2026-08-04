import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recommendationOwnerForRollout,
  recommendationsHouseholdOnlyForRollout,
  vodRecommendationsHouseholdOnly,
  vodRecommendationsV2Mode,
} from './v2-mode.js';

test('VOD v2 mode fails closed and isolates household-only UI to serve', () => {
  assert.equal(vodRecommendationsV2Mode(undefined), 'off');
  assert.equal(vodRecommendationsV2Mode('unexpected'), 'off');
  assert.equal(vodRecommendationsV2Mode(' SHADOW '), 'shadow');
  assert.equal(vodRecommendationsV2Mode('serve'), 'serve');
  assert.equal(vodRecommendationsHouseholdOnly('off'), false);
  assert.equal(vodRecommendationsHouseholdOnly('shadow'), false);
  assert.equal(vodRecommendationsHouseholdOnly('serve'), true);
});

test('YouTube rollout mode never takes ownership of VOD profile and mood state', () => {
  const modes = ['off', 'shadow', 'serve'] as const;
  for (const vodMode of modes) {
    for (const youtubeMode of modes) {
      assert.equal(
        recommendationsHouseholdOnlyForRollout(vodMode, youtubeMode),
        vodMode === 'serve',
        `VOD=${vodMode}, YouTube=${youtubeMode}`,
      );
      assert.equal(
        recommendationOwnerForRollout('vod', 'aman', vodMode, youtubeMode),
        vodMode === 'serve' ? 'household' : 'aman',
        `VOD slate owner for VOD=${vodMode}, YouTube=${youtubeMode}`,
      );
      assert.equal(
        recommendationOwnerForRollout('youtube', 'aman', vodMode, youtubeMode),
        youtubeMode === 'serve' ? 'household' : 'aman',
        `YouTube slate owner for VOD=${vodMode}, YouTube=${youtubeMode}`,
      );
    }
  }
});

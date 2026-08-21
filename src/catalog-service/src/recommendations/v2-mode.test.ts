import assert from 'node:assert/strict';
import test from 'node:test';
import {
  recommendationOwnerForRollout,
  recommendationsHouseholdOnlyForRollout,
  vodRecommendationsHouseholdOnly,
  vodRecommendationsV2Mode,
} from './v2-mode.js';

test('VOD v2 mode fails closed and uses Household identity for all active modes', () => {
  assert.equal(vodRecommendationsV2Mode(undefined), 'off');
  assert.equal(vodRecommendationsV2Mode('unexpected'), 'off');
  assert.equal(vodRecommendationsV2Mode(' SHADOW '), 'shadow');
  assert.equal(vodRecommendationsV2Mode('serve'), 'serve');
  assert.equal(vodRecommendationsHouseholdOnly('off'), false);
  assert.equal(vodRecommendationsHouseholdOnly('shadow'), true);
  assert.equal(vodRecommendationsHouseholdOnly('serve'), true);
});

test('each active recommendation domain uses Household without mutating dormant profiles', () => {
  const modes = ['off', 'shadow', 'serve'] as const;
  for (const vodMode of modes) {
    for (const youtubeMode of modes) {
      assert.equal(
        recommendationsHouseholdOnlyForRollout(vodMode, youtubeMode),
        vodMode !== 'off',
        `VOD=${vodMode}, YouTube=${youtubeMode}`,
      );
      assert.equal(
        recommendationOwnerForRollout('vod', 'aman', vodMode, youtubeMode),
        vodMode !== 'off' ? 'household' : 'aman',
        `VOD slate owner for VOD=${vodMode}, YouTube=${youtubeMode}`,
      );
      assert.equal(
        recommendationOwnerForRollout('youtube', 'aman', vodMode, youtubeMode),
        youtubeMode !== 'off' ? 'household' : 'aman',
        `YouTube slate owner for VOD=${vodMode}, YouTube=${youtubeMode}`,
      );
    }
  }
});

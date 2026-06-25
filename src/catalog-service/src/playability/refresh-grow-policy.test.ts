import assert from 'node:assert/strict';
import test from 'node:test';
import {
  growRailMeetsPublishFloor,
  resolveGrowPublishPolicy,
} from './refresh.js';

const rail = (
  railId: string,
  verifiedPool: number,
  minDisplay: number,
  growTargetMet: boolean,
) => ({
  rail_id: railId,
  after: { verified_pool: verifiedPool },
  min_display: minDisplay,
  grow_target_met: growTargetMet,
} as Parameters<typeof resolveGrowPublishPolicy>[0][number]);

test('best-effort grow publishes rails above display floor even when target is short', () => {
  const policy = resolveGrowPublishPolicy([
    rail('movies-a', 40, 9, true),
    rail('series-thin', 12, 9, false),
  ], { requireGrowTarget: false, finalizationOk: true });

  assert.equal(policy.ok, true);
  assert.equal(policy.all_rails_publishable, true);
  assert.equal(policy.grow_target_met, false);
  assert.equal(policy.grow_target_warning, true);
  assert.deepEqual(policy.grow_target_short_rails, ['series-thin']);
  assert.equal(policy.failure_category, undefined);
});

test('strict grow still fails when any rail misses the target', () => {
  const policy = resolveGrowPublishPolicy([
    rail('movies-a', 40, 9, true),
    rail('series-thin', 12, 9, false),
  ], { requireGrowTarget: true, finalizationOk: true });

  assert.equal(policy.ok, false);
  assert.equal(policy.failure_category, 'rail_grow_target_shortfall');
});

test('best-effort grow does not publish rails below display floor', () => {
  const shortRail = rail('series-empty', 4, 9, false);
  assert.equal(growRailMeetsPublishFloor(shortRail), false);

  const policy = resolveGrowPublishPolicy([
    rail('movies-a', 40, 9, true),
    shortRail,
  ], { requireGrowTarget: false, finalizationOk: true });

  assert.equal(policy.ok, false);
  assert.equal(policy.all_rails_publishable, false);
  assert.equal(policy.failure_category, 'rail_min_display_shortfall');
});

test('best-effort grow still fails if finalization breaks publish safety', () => {
  const policy = resolveGrowPublishPolicy([
    rail('movies-a', 40, 9, true),
    rail('series-thin', 12, 9, false),
  ], { requireGrowTarget: false, finalizationOk: false });

  assert.equal(policy.ok, false);
  assert.equal(policy.failure_category, 'retheme_finalization_failed');
});

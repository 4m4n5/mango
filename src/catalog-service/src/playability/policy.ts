import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PlayabilityPolicy = {
  version: 1;
  hardening_mode: 'shadow' | 'enforce';
  source_automation: 'off' | 'canary' | 'enforce';
  nightly: {
    deadline_minutes: number;
    admission_stop_minutes: number;
    stale_candidate_limit: number;
    stale_budget_fraction: number;
  };
  allocation: {
    breadth_fraction: number;
    exploration_fraction: number;
    max_source_fraction: number;
  };
  source_lifecycle: {
    consecutive_fetch_failures: number;
    no_win_candidate_limit: number;
    quarantine_days: number;
    promotion_nights: number;
    promotion_unique_candidates: number;
    promotion_exact_main_wins: number;
    promotion_min_yield: number;
    retire_failed_recanaries: number;
    retire_min_days: number;
    max_promoted_per_rail: number;
    canary_candidates_per_night: number;
    canary_budget_fraction: number;
  };
};

function policyPath(): string {
  if (process.env.MANGO_PLAYABILITY_POLICY_PATH) return process.env.MANGO_PLAYABILITY_POLICY_PATH;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../config/playability-policy.json');
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !(key in value));
  if (unknown.length || missing.length) {
    throw new Error(`${label} keys invalid unknown=${unknown.join(',')} missing=${missing.join(',')}`);
  }
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  }
  return Number(value);
}

function fraction(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be in [${min}, ${max}]`);
  }
  return value;
}

export function validatePlayabilityPolicy(input: unknown): PlayabilityPolicy {
  const root = object(input, 'playability policy');
  exactKeys(root, ['version', 'hardening_mode', 'source_automation', 'nightly', 'allocation', 'source_lifecycle'], 'playability policy');
  if (root.version !== 1) throw new Error('playability policy version must be 1');
  if (root.hardening_mode !== 'shadow' && root.hardening_mode !== 'enforce') throw new Error('invalid hardening_mode');
  if (!['off', 'canary', 'enforce'].includes(String(root.source_automation))) throw new Error('invalid source_automation');

  const nightly = object(root.nightly, 'nightly');
  exactKeys(nightly, ['deadline_minutes', 'admission_stop_minutes', 'stale_candidate_limit', 'stale_budget_fraction'], 'nightly');
  const deadlineMinutes = integer(nightly.deadline_minutes, 30, 360, 'nightly.deadline_minutes');
  const admissionStopMinutes = integer(nightly.admission_stop_minutes, 1, 345, 'nightly.admission_stop_minutes');
  if (admissionStopMinutes > deadlineMinutes - 10) throw new Error('nightly must reserve at least 10 minutes for publication');

  const allocation = object(root.allocation, 'allocation');
  exactKeys(allocation, ['breadth_fraction', 'exploration_fraction', 'max_source_fraction'], 'allocation');
  const sourceLifecycle = object(root.source_lifecycle, 'source_lifecycle');
  exactKeys(sourceLifecycle, [
    'consecutive_fetch_failures', 'no_win_candidate_limit', 'quarantine_days',
    'promotion_nights', 'promotion_unique_candidates', 'promotion_exact_main_wins',
    'promotion_min_yield', 'retire_failed_recanaries', 'retire_min_days',
    'max_promoted_per_rail', 'canary_candidates_per_night', 'canary_budget_fraction',
  ], 'source_lifecycle');

  return {
    version: 1,
    hardening_mode: root.hardening_mode,
    source_automation: root.source_automation as PlayabilityPolicy['source_automation'],
    nightly: {
      deadline_minutes: deadlineMinutes,
      admission_stop_minutes: admissionStopMinutes,
      stale_candidate_limit: integer(nightly.stale_candidate_limit, 1, 2000, 'nightly.stale_candidate_limit'),
      stale_budget_fraction: fraction(nightly.stale_budget_fraction, 0, 0.5, 'nightly.stale_budget_fraction'),
    },
    allocation: {
      breadth_fraction: fraction(allocation.breadth_fraction, 0, 0.5, 'allocation.breadth_fraction'),
      exploration_fraction: fraction(allocation.exploration_fraction, 0, 0.25, 'allocation.exploration_fraction'),
      max_source_fraction: fraction(allocation.max_source_fraction, 0.1, 1, 'allocation.max_source_fraction'),
    },
    source_lifecycle: {
      consecutive_fetch_failures: integer(sourceLifecycle.consecutive_fetch_failures, 1, 10, 'source_lifecycle.consecutive_fetch_failures'),
      no_win_candidate_limit: integer(sourceLifecycle.no_win_candidate_limit, 5, 500, 'source_lifecycle.no_win_candidate_limit'),
      quarantine_days: integer(sourceLifecycle.quarantine_days, 1, 90, 'source_lifecycle.quarantine_days'),
      promotion_nights: integer(sourceLifecycle.promotion_nights, 1, 30, 'source_lifecycle.promotion_nights'),
      promotion_unique_candidates: integer(sourceLifecycle.promotion_unique_candidates, 5, 1000, 'source_lifecycle.promotion_unique_candidates'),
      promotion_exact_main_wins: integer(sourceLifecycle.promotion_exact_main_wins, 1, 100, 'source_lifecycle.promotion_exact_main_wins'),
      promotion_min_yield: fraction(sourceLifecycle.promotion_min_yield, 0, 1, 'source_lifecycle.promotion_min_yield'),
      retire_failed_recanaries: integer(sourceLifecycle.retire_failed_recanaries, 1, 20, 'source_lifecycle.retire_failed_recanaries'),
      retire_min_days: integer(sourceLifecycle.retire_min_days, 7, 365, 'source_lifecycle.retire_min_days'),
      max_promoted_per_rail: integer(sourceLifecycle.max_promoted_per_rail, 1, 10, 'source_lifecycle.max_promoted_per_rail'),
      canary_candidates_per_night: integer(sourceLifecycle.canary_candidates_per_night, 1, 100, 'source_lifecycle.canary_candidates_per_night'),
      canary_budget_fraction: fraction(sourceLifecycle.canary_budget_fraction, 0, 0.1, 'source_lifecycle.canary_budget_fraction'),
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function playabilityPolicySnapshot(): { policy: PlayabilityPolicy; policy_hash: string; path: string } {
  const resolvedPath = policyPath();
  const policy = validatePlayabilityPolicy(JSON.parse(readFileSync(resolvedPath, 'utf8')));
  const policyHash = createHash('sha256').update(stableJson(policy)).digest('hex');
  return { policy, policy_hash: policyHash, path: resolvedPath };
}

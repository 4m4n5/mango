import type { CatalogCore } from '../core.js';
import type { Meta } from '../core.js';
import {
  clearRailSessions,
  deleteRailPoolTitle,
  listVerifiedPoolMemberships,
  upsertRailPoolTitle,
  type RailPoolMembership,
} from './db.js';
import { loadRailCurationOverrides } from './rail-overrides.js';
import {
  bestRailForTitle,
  loadRailThemeProfiles,
  metaHaystack,
  parseRuntimeMinutes,
  scoreThematicFit,
  type RailThemeProfile,
} from './rail-theme.js';

export type RethemeAction =
  | { action: 'keep'; rail_id: string; type: string; id: string; score: number }
  | { action: 'remove'; rail_id: string; type: string; id: string; score: number; reason: string }
  | { action: 'relocate'; from_rail: string; to_rail: string; type: string; id: string; score: number; target_score: number };

export type RethemePoolsResult = {
  ok: boolean;
  dry_run: boolean;
  memberships_scanned: number;
  unique_titles: number;
  kept: number;
  removed: number;
  relocated: number;
  meta_fetched: number;
  rails_touched: string[];
  actions: RethemeAction[];
};

const RELOCATE_MIN_SCORE = 12;
const RELOCATE_MARGIN = 10;
const ANCHOR_MOVIES_RAIL = 'movies-global-popular';
const ANCHOR_SERIES_RAIL = 'series-global-popular';

function fallbackRailForType(contentType: string): string {
  return contentType === 'movie' ? ANCHOR_MOVIES_RAIL : ANCHOR_SERIES_RAIL;
}

function resolveTargetRail(
  contentType: string,
  scores: Map<string, number>,
  enabledRailIds: Set<string>,
): string {
  const best = bestRailForTitle(scores);
  if (best && best.score >= RELOCATE_MIN_SCORE && enabledRailIds.has(best.rail_id)) {
    return best.rail_id;
  }
  const fallback = fallbackRailForType(contentType);
  return enabledRailIds.has(fallback) ? fallback : best?.rail_id ?? fallback;
}

function pinKey(railId: string, type: string, id: string): string {
  return `${railId}:${type}:${id}`;
}

function membershipKey(type: string, id: string): string {
  return `${type}|${id}`;
}

function parseMembershipKey(key: string): { type: string; id: string } {
  const sep = key.indexOf('|');
  return { type: key.slice(0, sep), id: key.slice(sep + 1) };
}

function railsForContentType(
  profiles: Map<string, RailThemeProfile>,
  contentType: string,
): RailThemeProfile[] {
  return [...profiles.values()].filter((profile) => {
    if (profile.rail_id.startsWith('movies-')) {
      return contentType === 'movie';
    }
    if (profile.rail_id.startsWith('series-')) {
      return contentType === 'series';
    }
    if (profile.rail_id === 'ai-horror') {
      return contentType === 'movie';
    }
    return true;
  });
}

async function fetchMetaCached(
  core: CatalogCore,
  type: string,
  id: string,
  cache: Map<string, Meta | null>,
  withMeta: boolean,
): Promise<Meta | null> {
  const key = `${type}:${id}`;
  if (!withMeta) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  try {
    const meta = await core.meta(type, id);
    cache.set(key, meta);
    return meta;
  } catch {
    cache.set(key, null);
    return null;
  }
}

export async function rethemeRailPools(
  core: CatalogCore,
  options: {
    dryRun?: boolean;
    withMeta?: boolean;
    preserveTitles?: boolean;
    railFilter?: string;
    metaConcurrency?: number;
  } = {},
): Promise<RethemePoolsResult> {
  const dryRun = options.dryRun !== false;
  const withMeta = options.withMeta !== false;
  const preserveTitles = options.preserveTitles !== false;
  const railFilter = options.railFilter?.trim() || null;

  const [profiles, overrides, memberships] = await Promise.all([
    loadRailThemeProfiles(),
    loadRailCurationOverrides(),
    listVerifiedPoolMemberships(),
  ]);

  const enabledRailIds = new Set(core.browsableRails().map((rail) => rail.id));

  const pinned = new Set(
    overrides.pins.map((pin) => pinKey(pin.rail_id, pin.type, pin.id)),
  );

  const byTitle = new Map<string, RailPoolMembership[]>();
  for (const row of memberships) {
    if (!enabledRailIds.has(row.rail_id)) continue;
    if (railFilter && row.rail_id !== railFilter) continue;
    if (!profiles.has(row.rail_id)) continue;
    const key = membershipKey(row.type, row.id);
    const bucket = byTitle.get(key) ?? [];
    bucket.push(row);
    byTitle.set(key, bucket);
  }

  const metaCache = new Map<string, Meta | null>();
  const actions: RethemeAction[] = [];
  const railsTouched = new Set<string>();
  let removed = 0;
  let relocated = 0;
  let kept = 0;
  let metaFetched = 0;

  for (const [titleKey, rows] of byTitle) {
    const { type, id } = parseMembershipKey(titleKey);
    const poolTitle = rows.find((row) => row.title)?.title ?? null;
    const meta = await fetchMetaCached(core, type, id, metaCache, withMeta);
    if (withMeta && metaCache.has(titleKey)) metaFetched += 1;
    const haystack = metaHaystack(meta, poolTitle);
    const runtimeMinutes = type === 'movie' ? parseRuntimeMinutes(meta) : null;

    const applicable = railsForContentType(profiles, type)
      .filter((profile) => enabledRailIds.has(profile.rail_id));
    const scores = new Map<string, number>();
    for (const profile of applicable) {
      scores.set(profile.rail_id, scoreThematicFit(haystack, profile, runtimeMinutes));
    }
    const best = bestRailForTitle(scores);
    const targetRail = resolveTargetRail(type, scores, enabledRailIds);
    const ensuredRails = new Set<string>();

    for (const row of rows) {
      const profile = profiles.get(row.rail_id);
      if (!profile) continue;
      const score = scores.get(row.rail_id) ?? 0;
      if (pinned.has(pinKey(row.rail_id, type, id))) {
        kept += 1;
        actions.push({ action: 'keep', rail_id: row.rail_id, type, id, score });
        continue;
      }

      const excludeHit = [...profile.exclude_tags].some(
        (tag) => tag.length >= 4 && haystack.includes(tag),
      );
      const belowMin = score < profile.min_fit;
      const betterElsewhere = Boolean(
        best
        && best.rail_id !== row.rail_id
        && best.score >= RELOCATE_MIN_SCORE
        && best.score >= score + RELOCATE_MARGIN,
      );

      if (!belowMin && !excludeHit && !betterElsewhere) {
        kept += 1;
        actions.push({ action: 'keep', rail_id: row.rail_id, type, id, score });
        continue;
      }

      const reason = excludeHit
        ? 'exclude_match'
        : betterElsewhere
          ? 'better_rail_available'
          : 'below_min_fit';
      actions.push({ action: 'remove', rail_id: row.rail_id, type, id, score, reason });
      railsTouched.add(row.rail_id);
      removed += 1;
      if (!dryRun) {
        await deleteRailPoolTitle(row.rail_id, type, id);
      }

      if (preserveTitles) {
        const alreadyPresent = rows.some((entry) => entry.rail_id === targetRail)
          || ensuredRails.has(targetRail);
        if (!alreadyPresent && targetRail !== row.rail_id) {
          const targetScore = scores.get(targetRail) ?? 0;
          actions.push({
            action: 'relocate',
            from_rail: row.rail_id,
            to_rail: targetRail,
            type,
            id,
            score,
            target_score: targetScore,
          });
          railsTouched.add(targetRail);
          relocated += 1;
          ensuredRails.add(targetRail);
          if (!dryRun) {
            await upsertRailPoolTitle({
              rail_id: targetRail,
              type,
              id,
              score: Math.max(80, targetScore),
              title: poolTitle ?? undefined,
            });
          }
        }
      }
    }
  }

  if (!dryRun && railsTouched.size > 0) {
    await clearRailSessions([...railsTouched]);
  }

  return {
    ok: true,
    dry_run: dryRun,
    memberships_scanned: memberships.length,
    unique_titles: byTitle.size,
    kept,
    removed,
    relocated,
    meta_fetched: metaCache.size,
    rails_touched: [...railsTouched].sort(),
    actions,
  };
}

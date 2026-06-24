import type { CatalogCore } from '../core.js';
import type { Meta } from '../core.js';
import {
  clearRailSessions,
  deleteRailPoolTitle,
  listOrphanVerifiedPoolTitles,
  listVerifiedPoolMemberships,
  recoverOrphanVerifiedPoolTitles,
  upsertRailPoolTitle,
  type RailPoolMembership,
} from './db.js';
import { loadRailCurationOverrides } from './rail-overrides.js';
import {
  bestRailForTitle,
  haystackHasThemeTag,
  loadRailThemeProfiles,
  metaHaystack,
  parseRuntimeMinutes,
  scoreThematicFit,
  type RailThemeProfile,
} from './rail-theme.js';

export type RethemeAction =
  | { action: 'keep'; rail_id: string; type: string; id: string; score: number }
  | { action: 'remove'; rail_id: string; type: string; id: string; score: number; reason: string }
  | { action: 'attach'; rail_id: string; type: string; id: string; target_score: number; reason: string }
  | { action: 'relocate'; from_rail: string; to_rail: string; type: string; id: string; score: number; target_score: number };

export type RethemePoolsResult = {
  ok: boolean;
  dry_run: boolean;
  include_orphans: boolean;
  max_rails_per_title: number;
  memberships_scanned: number;
  orphans_scanned: number;
  unique_titles: number;
  kept: number;
  removed: number;
  overlap_removed: number;
  relocated: number;
  attached: number;
  meta_fetched: number;
  rails_touched: string[];
  actions: RethemeAction[];
};

export type AssignVerifiedTitleResult = {
  ok: true;
  rail_id: string;
  type: string;
  id: string;
  score: number;
  reason: 'preferred_fit' | 'best_fit' | 'anchor_fallback';
};

export type RethemeCore = Pick<CatalogCore, 'browsableRails' | 'meta'>;

const RELOCATE_MIN_SCORE = 12;
const RELOCATE_MARGIN = 10;
const DEFAULT_MAX_RAILS_PER_TITLE = 2;
const ANCHOR_MOVIES_RAIL = 'movies-global-popular';
const ANCHOR_SERIES_RAIL = 'series-global-popular';
const ANCHOR_RAILS = new Set([ANCHOR_MOVIES_RAIL, ANCHOR_SERIES_RAIL]);

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

function isAnchorRail(railId: string): boolean {
  return ANCHOR_RAILS.has(railId);
}

function profileExcludeHit(profile: RailThemeProfile, haystack: string): boolean {
  return [...profile.exclude_tags].some(
    (tag) => tag.length >= 4 && haystackHasThemeTag(haystack, tag),
  );
}

function targetScoresForProfiles(
  profiles: RailThemeProfile[],
  scores: Map<string, number>,
  enabledRailIds: Set<string>,
  blockedRailIds: Set<string>,
): Map<string, number> {
  const eligible = new Map<string, number>();
  for (const profile of profiles) {
    if (!enabledRailIds.has(profile.rail_id)) continue;
    if (blockedRailIds.has(profile.rail_id)) continue;
    const score = scores.get(profile.rail_id) ?? 0;
    if (!isAnchorRail(profile.rail_id) && score < profile.min_fit) continue;
    eligible.set(profile.rail_id, score);
  }
  return eligible;
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

function maxRailsPerTitleOption(raw: number | undefined): number {
  const envRaw = process.env.MANGO_RETHEME_MAX_RAILS_PER_TITLE;
  const value = raw ?? (envRaw === undefined || envRaw === '' ? DEFAULT_MAX_RAILS_PER_TITLE : Number(envRaw));
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return DEFAULT_MAX_RAILS_PER_TITLE;
  }
  return value;
}

async function fetchMetaCached(
  core: RethemeCore,
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

export async function assignVerifiedTitleToBestRail(
  core: RethemeCore,
  input: {
    type: string;
    id: string;
    preferredRailId?: string | null;
    title?: string | null;
    poster_url?: string | null;
    year?: string | null;
  },
): Promise<AssignVerifiedTitleResult> {
  const [profiles, meta] = await Promise.all([
    loadRailThemeProfiles(),
    fetchMetaCached(core, input.type, input.id, new Map(), true),
  ]);
  const enabledRailIds = new Set(core.browsableRails().map((rail) => rail.id));
  const applicable = railsForContentType(profiles, input.type)
    .filter((profile) => enabledRailIds.has(profile.rail_id));
  const title = input.title ?? meta?.name ?? null;
  const haystack = metaHaystack(meta, title);
  const runtimeMinutes = input.type === 'movie' ? parseRuntimeMinutes(meta) : null;
  const scores = new Map<string, number>();
  for (const profile of applicable) {
    scores.set(profile.rail_id, scoreThematicFit(haystack, profile, runtimeMinutes));
  }
  const blockedRailIds = new Set(
    applicable
      .filter((profile) => profileExcludeHit(profile, haystack))
      .map((profile) => profile.rail_id),
  );
  const targetScores = targetScoresForProfiles(applicable, scores, enabledRailIds, blockedRailIds);
  const preferredRailId = input.preferredRailId && targetScores.has(input.preferredRailId)
    ? input.preferredRailId
    : null;
  const best = bestRailForTitle(targetScores);
  const targetRail = preferredRailId ?? resolveTargetRail(input.type, targetScores, enabledRailIds);
  const targetScore = scores.get(targetRail) ?? 0;
  const reason = preferredRailId
    ? 'preferred_fit'
    : best && best.rail_id === targetRail && best.score >= RELOCATE_MIN_SCORE
      ? 'best_fit'
      : 'anchor_fallback';
  const year = input.year
    ?? (typeof meta?.releaseInfo === 'string'
      ? meta.releaseInfo.match(/\d{4}/)?.[0]
      : undefined);
  await upsertRailPoolTitle({
    rail_id: targetRail,
    type: input.type,
    id: input.id,
    score: Math.max(80, targetScore),
    title: title ?? undefined,
    poster_url: input.poster_url ?? (typeof meta?.poster === 'string' ? meta.poster : undefined),
    year,
  });
  await clearRailSessions([targetRail]);
  return {
    ok: true,
    rail_id: targetRail,
    type: input.type,
    id: input.id,
    score: targetScore,
    reason,
  };
}

export async function rethemeRailPools(
  core: RethemeCore,
  options: {
    dryRun?: boolean;
    withMeta?: boolean;
    preserveTitles?: boolean;
    railFilter?: string;
    includeOrphans?: boolean;
    orphanLimit?: number;
    maxRailsPerTitle?: number;
    metaConcurrency?: number;
  } = {},
): Promise<RethemePoolsResult> {
  const dryRun = options.dryRun !== false;
  const withMeta = options.withMeta !== false;
  const preserveTitles = options.preserveTitles !== false;
  const railFilter = options.railFilter?.trim() || null;
  const includeOrphans = options.includeOrphans === true;
  const orphanLimit = options.orphanLimit && Number.isFinite(options.orphanLimit)
    ? Math.max(0, Math.floor(options.orphanLimit))
    : null;
  const maxRailsPerTitle = maxRailsPerTitleOption(options.maxRailsPerTitle);

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
  let overlapRemoved = 0;
  let relocated = 0;
  let attached = 0;
  let kept = 0;
  let processed = 0;
  const progressEvery = Number(process.env.MANGO_RETHEME_PROGRESS_EVERY ?? 25);

  for (const [titleKey, rows] of byTitle) {
    processed += 1;
    if (progressEvery > 0 && processed % progressEvery === 0) {
      console.error(`retheme: scored ${processed}/${byTitle.size} pool titles…`);
    }
    const { type, id } = parseMembershipKey(titleKey);
    const poolTitle = rows.find((row) => row.title)?.title ?? null;
    const meta = await fetchMetaCached(core, type, id, metaCache, withMeta);
    const haystack = metaHaystack(meta, poolTitle);
    const runtimeMinutes = type === 'movie' ? parseRuntimeMinutes(meta) : null;

    const applicable = railsForContentType(profiles, type)
      .filter((profile) => enabledRailIds.has(profile.rail_id));
    const scores = new Map<string, number>();
    for (const profile of applicable) {
      scores.set(profile.rail_id, scoreThematicFit(haystack, profile, runtimeMinutes));
    }
    const blockedRailIds = new Set(
      applicable
        .filter((profile) => profileExcludeHit(profile, haystack))
        .map((profile) => profile.rail_id),
    );
    const targetScores = targetScoresForProfiles(applicable, scores, enabledRailIds, blockedRailIds);
    const best = bestRailForTitle(targetScores);
    const targetRail = resolveTargetRail(type, targetScores, enabledRailIds);

    type RowDecision = {
      row: RailPoolMembership;
      score: number;
      remove: boolean;
      pinned: boolean;
      reason?: string;
    };
    const decisions: RowDecision[] = [];

    for (const row of rows) {
      const profile = profiles.get(row.rail_id);
      if (!profile) continue;
      const score = scores.get(row.rail_id) ?? 0;
      if (pinned.has(pinKey(row.rail_id, type, id))) {
        decisions.push({ row, score, remove: false, pinned: true });
        continue;
      }

      const excludeHit = blockedRailIds.has(row.rail_id);
      const belowMin = !isAnchorRail(row.rail_id) && score < profile.min_fit;
      const betterElsewhere = Boolean(
        best
        && best.rail_id !== row.rail_id
        && best.score >= RELOCATE_MIN_SCORE
        && best.score >= score + RELOCATE_MARGIN,
      );

      if (!belowMin && !excludeHit && !betterElsewhere) {
        decisions.push({ row, score, remove: false, pinned: false });
        continue;
      }

      const reason = excludeHit
        ? 'exclude_match'
        : betterElsewhere
          ? 'better_rail_available'
          : 'below_min_fit';
      decisions.push({ row, score, remove: true, pinned: false, reason });
    }

    const unpinnedKept = decisions.filter((decision) => !decision.remove && !decision.pinned);
    if (unpinnedKept.length > maxRailsPerTitle) {
      const allowed = new Set(
        [...unpinnedKept]
          .sort((a, b) => {
            const aTargetBoost = a.row.rail_id === targetRail ? 10_000 : 0;
            const bTargetBoost = b.row.rail_id === targetRail ? 10_000 : 0;
            return (b.score + bTargetBoost) - (a.score + aTargetBoost)
              || b.row.rail_id.localeCompare(a.row.rail_id);
          })
          .slice(0, maxRailsPerTitle)
          .map((decision) => decision.row.rail_id),
      );
      for (const decision of unpinnedKept) {
        if (allowed.has(decision.row.rail_id)) {
          continue;
        }
        decision.remove = true;
        decision.reason = 'overlap_cap';
      }
    }

    for (const decision of decisions.filter((candidate) => !candidate.remove)) {
      kept += 1;
      actions.push({
        action: 'keep',
        rail_id: decision.row.rail_id,
        type,
        id,
        score: decision.score,
      });
    }

    const toRemove = decisions.filter((decision) => decision.remove);
    if (toRemove.length === 0) {
      continue;
    }

    const keepingRails = new Set(
      decisions.filter((decision) => !decision.remove).map((decision) => decision.row.rail_id),
    );
    const targetScore = scores.get(targetRail) ?? 0;
    const needsEnsure = preserveTitles && !keepingRails.has(targetRail);

    if (needsEnsure) {
      actions.push({
        action: 'relocate',
        from_rail: toRemove[0]!.row.rail_id,
        to_rail: targetRail,
        type,
        id,
        score: toRemove[0]!.score,
        target_score: targetScore,
      });
      railsTouched.add(targetRail);
      relocated += 1;
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

    for (const decision of toRemove) {
      const reason = decision.reason ?? 'below_min_fit';
      actions.push({
        action: 'remove',
        rail_id: decision.row.rail_id,
        type,
        id,
        score: decision.score,
        reason,
      });
      railsTouched.add(decision.row.rail_id);
      removed += 1;
      if (reason === 'overlap_cap') {
        overlapRemoved += 1;
      }
      if (!dryRun) {
        await deleteRailPoolTitle(decision.row.rail_id, type, id);
      }
    }
  }

  let orphansScanned = 0;
  if (includeOrphans) {
    const allOrphans = await listOrphanVerifiedPoolTitles();
    const orphans = orphanLimit === null ? allOrphans : allOrphans.slice(0, orphanLimit);
    orphansScanned = orphans.length;
    for (const orphan of orphans) {
      processed += 1;
      if (progressEvery > 0 && processed % progressEvery === 0) {
        console.error(`retheme: scored ${processed}/${byTitle.size + orphans.length} titles…`);
      }
      const meta = await fetchMetaCached(
        core,
        orphan.type,
        orphan.id,
        metaCache,
        withMeta,
      );
      const title = meta?.name ?? orphan.display_title ?? null;
      const haystack = metaHaystack(meta, title);
      const runtimeMinutes = orphan.type === 'movie' ? parseRuntimeMinutes(meta) : null;
      const applicable = railsForContentType(profiles, orphan.type)
        .filter((profile) => enabledRailIds.has(profile.rail_id));
      const scores = new Map<string, number>();
      for (const profile of applicable) {
        scores.set(profile.rail_id, scoreThematicFit(haystack, profile, runtimeMinutes));
      }
      const blockedRailIds = new Set(
        applicable
          .filter((profile) => profileExcludeHit(profile, haystack))
          .map((profile) => profile.rail_id),
      );
      const targetScores = targetScoresForProfiles(applicable, scores, enabledRailIds, blockedRailIds);
      const best = bestRailForTitle(targetScores);
      const targetRail = resolveTargetRail(orphan.type, targetScores, enabledRailIds);
      if (railFilter && targetRail !== railFilter) {
        continue;
      }
      const targetScore = scores.get(targetRail) ?? 0;
      const reason = best
        && best.rail_id === targetRail
        && best.score >= RELOCATE_MIN_SCORE
        ? 'orphan_best_fit'
        : 'orphan_anchor_fallback';
      actions.push({
        action: 'attach',
        rail_id: targetRail,
        type: orphan.type,
        id: orphan.id,
        target_score: targetScore,
        reason,
      });
      railsTouched.add(targetRail);
      attached += 1;
      if (!dryRun) {
        await upsertRailPoolTitle({
          rail_id: targetRail,
          type: orphan.type,
          id: orphan.id,
          score: Math.max(80, targetScore),
          title,
          poster_url: typeof meta?.poster === 'string' ? meta.poster : undefined,
          year: typeof meta?.releaseInfo === 'string'
            ? meta.releaseInfo.match(/\d{4}/)?.[0]
            : undefined,
        });
      }
    }
  }

  if (!dryRun && preserveTitles && !includeOrphans) {
    const recovered = await recoverOrphanVerifiedPoolTitles();
    if (recovered > 0) {
      railsTouched.add(ANCHOR_MOVIES_RAIL);
      railsTouched.add(ANCHOR_SERIES_RAIL);
    }
  }

  if (!dryRun && railsTouched.size > 0) {
    await clearRailSessions([...railsTouched]);
  }

  return {
    ok: true,
    dry_run: dryRun,
    include_orphans: includeOrphans,
    max_rails_per_title: maxRailsPerTitle,
    memberships_scanned: memberships.length,
    orphans_scanned: orphansScanned,
    unique_titles: byTitle.size + orphansScanned,
    kept,
    removed,
    overlap_removed: overlapRemoved,
    relocated,
    attached,
    meta_fetched: metaCache.size,
    rails_touched: [...railsTouched].sort(),
    actions,
  };
}

import type { CatalogCore, Meta } from '../core.js';
import type { CandidateMeta } from './list-source.js';
import { loadRailCurationOverrides, type RailCurationOverrides } from './rail-overrides.js';
import {
  loadRailThemeProfiles,
  metaHaystack,
  parseRuntimeMinutes,
  scoreThematicFit,
  type RailThemeProfile,
} from './rail-theme.js';

const ANCHOR_RAILS = new Set(['movies-global-popular', 'series-global-popular']);

export type RailThemeFitResult = {
  fit: boolean;
  score: number;
  reason: 'pinned' | 'no_profile' | 'anchor' | 'title_match' | 'meta_match' | 'below_min_fit' | 'exclude_match';
};

function pinKey(railId: string, type: string, id: string): string {
  return `${railId}:${type}:${id}`;
}

function isPinned(
  railId: string,
  type: string,
  id: string,
  overrides: RailCurationOverrides,
): boolean {
  return overrides.pins.some(
    (pin) => pin.rail_id === railId && pin.type === type && pin.id === id,
  );
}

function excludeHit(haystack: string, profile: RailThemeProfile): boolean {
  return [...profile.exclude_tags].some(
    (tag) => tag.length >= 4 && haystack.includes(tag),
  );
}

function evaluateHaystack(
  haystack: string,
  profile: RailThemeProfile,
  runtimeMinutes: number | null,
): RailThemeFitResult {
  const score = scoreThematicFit(haystack, profile, runtimeMinutes);
  if (excludeHit(haystack, profile)) {
    return { fit: false, score, reason: 'exclude_match' };
  }
  if (score < profile.min_fit) {
    return { fit: false, score, reason: 'below_min_fit' };
  }
  return { fit: true, score, reason: 'title_match' };
}

export function themeGateEnabled(): boolean {
  return process.env.MANGO_RAIL_THEME_GATE !== '0';
}

export class RailThemeGate {
  private metaCache = new Map<string, Meta | null>();

  private constructor(
    private readonly core: CatalogCore,
    private readonly profiles: Map<string, RailThemeProfile>,
    private readonly overrides: RailCurationOverrides,
  ) {}

  static async create(core: CatalogCore): Promise<RailThemeGate> {
    const [profiles, overrides] = await Promise.all([
      loadRailThemeProfiles(),
      loadRailCurationOverrides(),
    ]);
    return new RailThemeGate(core, profiles, overrides);
  }

  static forTest(
    profiles: Map<string, RailThemeProfile>,
    overrides: RailCurationOverrides,
    core?: CatalogCore,
  ): RailThemeGate {
    const stubCore = (core ?? {
      meta: async () => {
        throw new Error('meta_unavailable');
      },
    }) as CatalogCore;
    return new RailThemeGate(stubCore, profiles, overrides);
  }

  scoreTitleOnly(railId: string, candidate: CandidateMeta): RailThemeFitResult {
    const profile = this.profiles.get(railId);
    if (!profile) {
      return { fit: true, score: 0, reason: 'no_profile' };
    }
    if (isPinned(railId, candidate.type, candidate.id, this.overrides)) {
      return { fit: true, score: 999, reason: 'pinned' };
    }
    if (ANCHOR_RAILS.has(railId)) {
      return { fit: true, score: profile.min_fit, reason: 'anchor' };
    }
    const haystack = metaHaystack(null, candidate.title);
    const runtimeMinutes = candidate.type === 'movie' ? null : null;
    return evaluateHaystack(haystack, profile, runtimeMinutes);
  }

  /** Skip probes only for high-confidence title-only mismatches. */
  shouldSkipProbe(railId: string, candidate: CandidateMeta): boolean {
    if (!themeGateEnabled()) return false;
    const result = this.scoreTitleOnly(railId, candidate);
    if (result.fit || result.reason === 'pinned' || result.reason === 'anchor' || result.reason === 'no_profile') {
      return false;
    }
    return result.reason === 'exclude_match';
  }

  async fitsRail(railId: string, candidate: CandidateMeta): Promise<RailThemeFitResult> {
    if (!themeGateEnabled()) {
      return { fit: true, score: 0, reason: 'no_profile' };
    }

    const titleOnly = this.scoreTitleOnly(railId, candidate);
    if (titleOnly.reason === 'pinned' || titleOnly.reason === 'anchor' || titleOnly.reason === 'no_profile') {
      return titleOnly;
    }
    if (titleOnly.fit) {
      return titleOnly;
    }

    const profile = this.profiles.get(railId);
    if (!profile) {
      return { fit: true, score: 0, reason: 'no_profile' };
    }

    const meta = await this.fetchMeta(candidate.type, candidate.id);
    const haystack = metaHaystack(meta, candidate.title);
    const runtimeMinutes = candidate.type === 'movie' ? parseRuntimeMinutes(meta) : null;
    const scored = evaluateHaystack(haystack, profile, runtimeMinutes);
    return {
      ...scored,
      reason: scored.fit ? 'meta_match' : scored.reason,
    };
  }

  private async fetchMeta(type: string, id: string): Promise<Meta | null> {
    const key = `${type}:${id}`;
    if (this.metaCache.has(key)) {
      return this.metaCache.get(key) ?? null;
    }
    try {
      const meta = await this.core.meta(type, id);
      this.metaCache.set(key, meta);
      return meta;
    } catch {
      this.metaCache.set(key, null);
      return null;
    }
  }
}

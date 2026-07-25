import { randomUUID } from 'node:crypto';
import { CatalogError, type CatalogCore } from '../core.js';
import {
  clearSearchActivity,
  getSearchPreferences,
  listSearchHistory,
  listSearchSelections,
  listSearchStarterItems,
  recordSearchQuery,
  recordSearchSelection,
  setSearchPreferences,
  type SearchSafeSearch,
} from '../library/db.js';
import { collectLiveSearchEntriesFromCache } from '../live/ai-catalog-seeds.js';
import {
  getTitlePlayability,
  listVerifiedLibraryCatalogRows,
  playabilitySearchGeneration,
  queueTitleForPlayabilityIngest,
} from '../playability/db.js';
import { metahubPosterUrl, normalizePosterUrl } from '../poster.js';
import { loadRailConfig } from '../rails.js';
import { searchExternalTitles, type ExternalSearchHit } from '../voice/external.js';
import { searchLiveChannels } from '../voice/live-search.js';
import {
  listYoutubeItems,
  youtubeRefreshStatus,
  youtubeSearchCacheSummary,
  youtubeSearchGeneration,
} from '../youtube/db.js';
import type { YoutubeService } from '../youtube/service.js';
import type { YoutubeItem, YoutubeSearchGroups } from '../youtube/types.js';
import { liveRailsCacheGeneration } from '../live-rails-cache.js';
import {
  isDescriptiveSearchQuery,
  normalizeSearchQuery,
  scoreSearchMatch,
  validateSearchQuery,
} from './normalize.js';
import type {
  SearchGroup,
  SearchPhase,
  SearchResult,
  SearchScope,
  SearchSnapshot,
} from './types.js';

const SEARCH_JOB_LIMIT = 32;
const SEARCH_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_RESULT_LIMIT = 50;
const PHASE_TIMEOUT_MS = 2_500;
const AI_TIMEOUT_MS = 4_000;

function validatedQuery(value: string): { display: string; normalized: string } {
  try {
    return validateSearchQuery(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid search query';
    throw new CatalogError(400, message, undefined, { couchMessage: message });
  }
}

type SearchJob = {
  snapshot: SearchSnapshot;
  cancelled: boolean;
  waiters: Set<() => void>;
  results: {
    local: SearchResult[];
    external: SearchResult[];
    live: SearchResult[];
    youtube: SearchResult[];
    related: SearchResult[];
  };
};

type IndexedResult = SearchResult & { searchable: string };

function scopeAllows(scope: SearchScope, result: SearchResult): boolean {
  if (scope === 'all') return result.kind !== 'channel' && result.kind !== 'playlist';
  if (scope === 'movies') return result.tab === 'movies';
  if (scope === 'series') return result.tab === 'series';
  if (scope === 'live') return result.tab === 'live';
  return result.tab === 'youtube';
}

function resultKey(result: Pick<SearchResult, 'source' | 'type' | 'id'>): string {
  return `${result.source}:${result.type}:${result.id}`;
}

function resultTab(type: string): SearchResult['tab'] {
  if (type === 'series') return 'series';
  if (type === 'tv') return 'live';
  if (type.startsWith('youtube_')) return 'youtube';
  return 'movies';
}

function youtubeResult(item: YoutubeItem, query: string): SearchResult | null {
  const scored = scoreSearchMatch(
    item.title,
    query,
    `${item.title} ${item.channel_title || ''} ${item.description || ''}`,
  );
  if (!scored) return null;
  const type = `youtube_${item.kind}`;
  return {
    key: `youtube:${type}:${item.id}`,
    source: 'youtube',
    type,
    id: item.id,
    title: item.title,
    subtitle: item.channel_title || item.subtitle || (item.live_status === 'live' ? 'live' : 'YouTube'),
    poster: item.thumbnail || undefined,
    description: item.description || undefined,
    tab: 'youtube',
    kind: item.kind,
    live_status: item.live_status,
    in_library: true,
    queued_for_verify: false,
    ...scored,
  };
}

function externalResult(hit: ExternalSearchHit, query: string): SearchResult {
  const scored = scoreSearchMatch(hit.title, query) || { score: hit.score, match: 'tokens' as const };
  return {
    key: `external:${hit.type}:${hit.id}`,
    source: hit.in_library ? 'mango' : 'external',
    type: hit.type,
    id: hit.id,
    title: hit.title,
    subtitle: [hit.year, hit.in_library ? 'in library' : 'more movies & shows'].filter(Boolean).join(' · '),
    poster: normalizePosterUrl(hit.poster) ?? metahubPosterUrl(hit.id) ?? undefined,
    year: hit.year,
    tab: hit.tab,
    in_library: hit.in_library,
    queued_for_verify: hit.queued_for_verify,
    score: Math.max(hit.score, scored.score),
    match: scored.match,
  };
}

function uniqueRanked(
  items: SearchResult[],
  selectionBoosts: Map<string, number>,
  limit = SEARCH_RESULT_LIMIT,
): SearchResult[] {
  const byKey = new Map<string, SearchResult>();
  for (const item of items) {
    const key = resultKey(item);
    const current = byKey.get(key);
    if (!current || item.score > current.score) byKey.set(key, item);
  }
  return [...byKey.values()]
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const boost = (selectionBoosts.get(right.key) || 0) - (selectionBoosts.get(left.key) || 0);
      return boost || left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

function phase(status: SearchPhase['status'], message?: string): SearchPhase {
  return message ? { status, message } : { status };
}

function emptyGroup(
  id: string,
  label: string,
  layout: SearchGroup['layout'],
  status: SearchGroup['status'] = 'empty',
  message?: string,
): SearchGroup {
  return { id, label, layout, items: [], total: 0, status, ...(message ? { message } : {}) };
}

async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class UnifiedSearchService {
  private readonly jobs = new Map<string, SearchJob>();
  private readonly sourceFlights = new Map<string, Promise<SearchResult[]>>();
  private index: IndexedResult[] = [];
  private indexBuiltAt = 0;
  private indexGeneration = '';
  private generationCheckedAt = 0;
  private indexFlight: Promise<void> | null = null;

  constructor(
    private readonly core: CatalogCore,
    private readonly youtube: YoutubeService,
  ) {}

  private async ensureIndex(force = false): Promise<void> {
    const hasBuiltIndex = this.indexBuiltAt > 0;
    const now = Date.now();
    if (!force && hasBuiltIndex && now - this.generationCheckedAt < 30_000) return;
    const generation = await this.currentIndexGeneration();
    this.generationCheckedAt = now;
    if (!force && hasBuiltIndex && generation === this.indexGeneration) return;
    if (!force && hasBuiltIndex) {
      if (!this.indexFlight) this.startIndexRebuild(generation);
      return;
    }
    if (this.indexFlight) return this.indexFlight;
    this.startIndexRebuild(generation);
    return this.indexFlight ?? undefined;
  }

  private async currentIndexGeneration(): Promise<string> {
    return [
      await playabilitySearchGeneration(),
      youtubeSearchGeneration(),
      liveRailsCacheGeneration(),
    ].join('|');
  }

  private startIndexRebuild(generation: string): void {
    this.indexFlight = (async () => {
      const next: IndexedResult[] = [];
      const seen = new Set<string>();
      for (const row of await listVerifiedLibraryCatalogRows(20_000)) {
        const key = `mango:${row.type}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const type = row.type;
        next.push({
          key,
          source: 'mango',
          type,
          id: row.id,
          title: row.title,
          subtitle: row.year || (type === 'series' ? 'TV show' : 'movie'),
          poster: normalizePosterUrl(row.poster) ?? metahubPosterUrl(row.id) ?? undefined,
          year: row.year ?? undefined,
          tab: resultTab(type),
          in_library: true,
          queued_for_verify: false,
          score: 0,
          match: 'tokens',
          searchable: row.title,
        });
      }
      for (const item of listYoutubeItems(null, 20_000)) {
        const result = youtubeResult(item, item.title);
        if (!result || seen.has(result.key)) continue;
        seen.add(result.key);
        next.push({
          ...result,
          score: 0,
          match: 'tokens',
          searchable: `${item.title} ${item.channel_title || ''} ${item.description || ''}`,
        });
      }
      for (const entry of collectLiveSearchEntriesFromCache()) {
        const title = entry.meta.name || entry.meta.title || entry.meta.id;
        const key = `mango:tv:${entry.meta.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({
          key,
          source: 'mango',
          type: 'tv',
          id: entry.meta.id,
          title,
          subtitle: entry.context || 'live channel',
          poster: entry.meta.poster,
          description: entry.meta.description,
          tab: 'live',
          in_library: true,
          queued_for_verify: false,
          score: 0,
          match: 'tokens',
          searchable: `${title} ${entry.context || ''} ${entry.meta.description || ''}`,
        });
      }
      this.index = next;
      this.indexGeneration = generation;
      this.indexBuiltAt = Date.now();
    })().finally(() => {
      this.indexFlight = null;
    });
  }

  private sharedSourceFlight(
    key: string,
    create: () => Promise<SearchResult[]>,
  ): Promise<SearchResult[]> {
    const existing = this.sourceFlights.get(key);
    if (existing) return existing;
    const flight = create();
    this.sourceFlights.set(key, flight);
    const clear = () => {
      if (this.sourceFlights.get(key) === flight) this.sourceFlights.delete(key);
    };
    void flight.then(clear, clear);
    return flight;
  }

  private searchIndex(query: string, scope: SearchScope, limit = SEARCH_RESULT_LIMIT): SearchResult[] {
    const results: SearchResult[] = [];
    for (const candidate of this.index) {
      if (!scopeAllows(scope, candidate)) continue;
      const scored = scoreSearchMatch(candidate.title, query, candidate.searchable);
      if (!scored) continue;
      results.push({ ...candidate, ...scored });
    }
    return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  }

  async state(): Promise<Record<string, unknown>> {
    await this.ensureIndex();
    return {
      ok: true,
      recents: listSearchHistory(),
      starters: listSearchStarterItems(12),
      preferences: getSearchPreferences(),
      sources: {
        mango: this.index.some((entry) => entry.source === 'mango' && entry.tab !== 'live'),
        live: this.index.some((entry) => entry.tab === 'live'),
        youtube: this.index.some((entry) => entry.source === 'youtube'),
        ai: Boolean(process.env.MANGO_SEARCH_AI_URL || process.env.MANGO_VOICE),
      },
      index: { items: this.index.length, built_at: this.indexBuiltAt },
      youtube: {
        refresh: youtubeRefreshStatus(),
        query_cache: youtubeSearchCacheSummary(),
      },
    };
  }

  async suggestions(query: string, scope: SearchScope, limit = 9): Promise<SearchResult[]> {
    const { normalized } = validatedQuery(query);
    await this.ensureIndex();
    return this.searchIndex(normalized, scope, Math.max(1, Math.min(12, limit)));
  }

  async startQuery(input: {
    query: string;
    scope: SearchScope;
    refresh_youtube?: boolean;
    diagnostic?: boolean;
  }): Promise<SearchSnapshot> {
    const { display, normalized } = validatedQuery(input.query);
    await this.ensureIndex();
    this.pruneJobs();
    const searchId = randomUUID();
    // Live cards enter submitted results only after the health-aware Live phase.
    const local = this.searchIndex(normalized, input.scope)
      .filter((result) => input.diagnostic || result.tab !== 'live');
    const now = Date.now();
    const job: SearchJob = {
      cancelled: false,
      waiters: new Set(),
      results: { local, external: [], live: [], youtube: [], related: [] },
      snapshot: {
        ok: true,
        search_id: searchId,
        query: display,
        normalized_query: normalized,
        scope: input.scope,
        revision: 1,
        complete: false,
        groups: [],
        phases: {
          local: phase(local.length > 0 ? 'ready' : 'empty'),
          external: input.diagnostic || input.scope === 'live' || input.scope === 'youtube'
            ? phase('skipped')
            : phase('pending'),
          live: input.diagnostic || input.scope === 'movies' || input.scope === 'series' || input.scope === 'youtube'
            ? phase('skipped')
            : phase('pending'),
          youtube: input.scope === 'movies' || input.scope === 'series' || input.scope === 'live'
            ? phase('skipped')
            : phase('pending'),
          ai: input.diagnostic ? phase('skipped') : phase('pending'),
        },
        created_at: now,
        updated_at: now,
      },
    };
    this.jobs.set(searchId, job);
    if (!input.diagnostic) recordSearchQuery(normalized, display);
    this.rebuildSnapshot(job);
    void this.runPhases(job, input);
    return structuredClone(job.snapshot);
  }

  snapshot(searchId: string): SearchSnapshot | null {
    const job = this.jobs.get(searchId);
    return job ? structuredClone(job.snapshot) : null;
  }

  async waitForSnapshot(searchId: string, afterRevision: number, waitMs: number): Promise<SearchSnapshot | null> {
    const job = this.jobs.get(searchId);
    if (!job) return null;
    if (job.snapshot.revision > afterRevision || waitMs <= 0) return structuredClone(job.snapshot);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        job.waiters.delete(done);
        resolve();
      }, Math.max(0, Math.min(25_000, waitMs)));
      const done = () => {
        clearTimeout(timeout);
        job.waiters.delete(done);
        resolve();
      };
      job.waiters.add(done);
    });
    return structuredClone(job.snapshot);
  }

  cancel(searchId: string): boolean {
    const job = this.jobs.get(searchId);
    if (!job) return false;
    job.cancelled = true;
    job.snapshot.complete = true;
    this.bump(job);
    return true;
  }

  recordSelection(input: {
    normalized_query: string;
    key: string;
    source: string;
    type: string;
    id: string;
    title: string;
  }): void {
    recordSearchSelection({
      normalized_query: normalizeSearchQuery(input.normalized_query),
      entity_key: input.key,
      source: input.source,
      type: input.type,
      id: input.id,
      title: input.title,
    });
  }

  clearActivity(): { history: number; selections: number } {
    return clearSearchActivity();
  }

  preferences(): ReturnType<typeof getSearchPreferences> {
    return getSearchPreferences();
  }

  setPreferences(safeSearch: SearchSafeSearch): ReturnType<typeof setSearchPreferences> {
    return setSearchPreferences({ youtube_safe_search: safeSearch });
  }

  async queueUnavailableExternal(input: {
    type: 'movie' | 'series';
    id: string;
    title: string;
    poster?: string;
    year?: string;
  }): Promise<{ queued: boolean; already_queued: boolean; in_library: boolean }> {
    const state = await getTitlePlayability(input.type, input.id);
    if (state?.status === 'verified') return { queued: false, already_queued: false, in_library: true };
    if (state?.status === 'pending') return { queued: false, already_queued: true, in_library: false };
    const config = await loadRailConfig();
    const tab = input.type === 'series' ? 'series' : 'movies';
    const rail = config.rails.find((entry) => entry.enabled && entry.tab === tab);
    const railId = rail?.id || (tab === 'series' ? 'series-global-popular' : 'movies-global-popular');
    await queueTitleForPlayabilityIngest({
      ...input,
      rail_id: railId,
      poster_url: input.poster,
      trigger_type: 'search_unavailable',
      reason: `search_selected_unavailable:${input.title}`,
    });
    return { queued: true, already_queued: false, in_library: false };
  }

  private async runPhases(
    job: SearchJob,
    input: { refresh_youtube?: boolean; diagnostic?: boolean },
  ): Promise<void> {
    const work: Promise<void>[] = [];
    if (job.snapshot.phases.external.status === 'pending') work.push(this.runExternal(job));
    if (job.snapshot.phases.live.status === 'pending') work.push(this.runLive(job));
    if (job.snapshot.phases.youtube.status === 'pending') {
      work.push(this.runYoutube(job, Boolean(input.refresh_youtube), Boolean(input.diagnostic)));
    }
    if (job.snapshot.phases.ai.status === 'pending') work.push(this.runAi(job));
    await Promise.allSettled(work);
    if (!job.cancelled) {
      job.snapshot.complete = true;
      this.bump(job);
    }
  }

  private async runExternal(job: SearchJob): Promise<void> {
    const started = Date.now();
    try {
      const results = await withDeadline(this.sharedSourceFlight(
        `external|${job.snapshot.normalized_query}|${job.snapshot.scope}`,
        async () => {
          const response = await searchExternalTitles(this.core, job.snapshot.query, {
            type: job.snapshot.scope === 'movies' ? 'movie' : job.snapshot.scope === 'series' ? 'series' : null,
            limit: 12,
            queue_missing: false,
          });
          return response.results.map((hit) => externalResult(hit, job.snapshot.query));
        },
      ), PHASE_TIMEOUT_MS);
      if (job.cancelled) return;
      job.results.external = results;
      job.snapshot.phases.external = {
        status: job.results.external.length > 0 ? 'ready' : 'empty',
        duration_ms: Date.now() - started,
      };
    } catch (error) {
      if (job.cancelled) return;
      job.snapshot.phases.external = {
        status: 'degraded',
        message: error instanceof Error && error.message === 'timed out'
          ? 'More movies & shows is taking too long'
          : 'More movies & shows is unavailable',
        duration_ms: Date.now() - started,
      };
    }
    this.bump(job);
  }

  private async runLive(job: SearchJob): Promise<void> {
    const started = Date.now();
    try {
      const results = await withDeadline(this.sharedSourceFlight(
        `live|${job.snapshot.normalized_query}`,
        async () => {
          const hits = await searchLiveChannels(job.snapshot.query, SEARCH_RESULT_LIMIT, this.core, {
            validateUnknown: true,
            maxUnknownValidations: 1,
          });
          return hits.map((hit): SearchResult => ({
            key: `mango:tv:${hit.id}`,
            source: 'mango',
            type: 'tv',
            id: hit.id,
            title: hit.title,
            subtitle: 'live channel',
            poster: hit.poster,
            tab: 'live',
            in_library: true,
            queued_for_verify: false,
            score: hit.score,
            match: scoreSearchMatch(hit.title, job.snapshot.query)?.match || 'tokens',
          }));
        },
      ), PHASE_TIMEOUT_MS);
      if (job.cancelled) return;
      job.results.live = results;
      job.snapshot.phases.live = {
        status: job.results.live.length > 0 ? 'ready' : 'empty',
        duration_ms: Date.now() - started,
      };
    } catch {
      if (job.cancelled) return;
      job.snapshot.phases.live = {
        status: 'degraded',
        message: 'Live search is unavailable',
        duration_ms: Date.now() - started,
      };
    }
    this.bump(job);
  }

  private async runYoutube(job: SearchJob, forceRefresh: boolean, diagnostic: boolean): Promise<void> {
    const started = Date.now();
    try {
      const response = await withDeadline(this.youtube.search(job.snapshot.query, 50, {
        kind_scope: job.snapshot.scope === 'youtube' ? 'youtube' : 'videos',
        safe_search: getSearchPreferences().youtube_safe_search,
        force_refresh: forceRefresh,
        cache_only: diagnostic,
        record_recent: false,
      }), PHASE_TIMEOUT_MS) as { groups: YoutubeSearchGroups; api_error?: string | null };
      if (job.cancelled) return;
      const items = job.snapshot.scope === 'youtube'
        ? [...response.groups.videos, ...response.groups.channels, ...response.groups.playlists]
        : response.groups.videos;
      job.results.youtube = items
        .map((item) => youtubeResult(item, job.snapshot.query))
        .filter((item): item is SearchResult => item !== null);
      job.snapshot.phases.youtube = {
        status: response.api_error ? 'degraded' : job.results.youtube.length > 0 ? 'ready' : 'empty',
        ...(response.api_error ? { message: 'Showing cached YouTube results' } : {}),
        duration_ms: Date.now() - started,
      };
      void this.ensureIndex(true).catch(() => {
        // Search results are already durable in youtube.db; keep serving the
        // previous atomic index if a background rebuild fails.
      });
    } catch (error) {
      if (job.cancelled) return;
      job.snapshot.phases.youtube = {
        status: 'degraded',
        message: error instanceof Error && error.message === 'timed out'
          ? 'YouTube search timed out'
          : 'YouTube search is unavailable',
        duration_ms: Date.now() - started,
      };
    }
    this.bump(job);
  }

  private async runAi(job: SearchJob): Promise<void> {
    if (job.snapshot.scope === 'live') {
      job.snapshot.phases.ai = phase('skipped');
      this.bump(job);
      return;
    }
    const strongLiteralCount = job.results.local.filter((item) => item.score >= 78).length;
    if (!isDescriptiveSearchQuery(job.snapshot.query) && strongLiteralCount >= 3) {
      job.snapshot.phases.ai = phase('skipped');
      this.bump(job);
      return;
    }
    const url = process.env.MANGO_SEARCH_AI_URL || 'http://127.0.0.1:8765/search/expand';
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: job.snapshot.query, scope: job.snapshot.scope }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { queries?: string[] };
      const queries = (payload.queries || []).map(normalizeSearchQuery).filter((query) => query.length >= 2).slice(0, 3);
      const related: SearchResult[] = [];
      for (const query of queries) {
        related.push(...this.searchIndex(query, job.snapshot.scope, 20)
          .filter((item) => item.tab !== 'live')
          .map((item) => ({
            ...item,
            key: item.key,
            score: Math.min(69, item.score),
            match: 'related' as const,
          })));
      }
      const remainingMs = Math.max(100, AI_TIMEOUT_MS - (Date.now() - started));
      const expandedExternal = job.snapshot.scope === 'youtube'
        ? []
        : await withDeadline(Promise.all(queries.map(async (query) => {
          const response = await searchExternalTitles(this.core, query, {
            type: job.snapshot.scope === 'movies' ? 'movie' : job.snapshot.scope === 'series' ? 'series' : null,
            limit: 8,
            queue_missing: false,
          });
          return response.results.map((hit) => ({
            ...externalResult(hit, query),
            score: Math.min(69, hit.score),
            match: 'related' as const,
          }));
        })), remainingMs).catch(() => []);
      related.push(...expandedExternal.flat());
      if (job.cancelled) return;
      job.results.related = related;
      job.snapshot.phases.ai = {
        status: related.length > 0 ? 'ready' : 'empty',
        duration_ms: Date.now() - started,
      };
    } catch {
      if (job.cancelled) return;
      job.snapshot.phases.ai = {
        status: 'skipped',
        message: 'Related results are unavailable',
        duration_ms: Date.now() - started,
      };
    }
    this.bump(job);
  }

  private selectionBoosts(job: SearchJob): Map<string, number> {
    const now = Date.now();
    const boosts = new Map<string, number>();
    for (const row of listSearchSelections(job.snapshot.normalized_query, 100)) {
      const ageDays = Math.max(0, (now - row.selected_at) / 86_400_000);
      const decay = Math.pow(0.5, ageDays / 30);
      boosts.set(row.entity_key, Math.min(5, Math.log2(row.selection_count + 1) * decay));
    }
    return boosts;
  }

  private rebuildSnapshot(job: SearchJob): void {
    const boosts = this.selectionBoosts(job);
    const combined = uniqueRanked([
      ...job.results.local,
      ...job.results.youtube,
      ...job.results.live,
      ...job.results.external.filter((item) => item.in_library),
    ], boosts);
    const movies = uniqueRanked(combined.filter((item) => item.tab === 'movies'), boosts);
    const series = uniqueRanked(combined.filter((item) => item.tab === 'series'), boosts);
    const live = uniqueRanked(combined.filter((item) => item.tab === 'live'), boosts);
    const youtubeVideos = uniqueRanked(
      combined.filter((item) => item.tab === 'youtube' && item.kind === 'video'),
      boosts,
    );
    const youtubeChannels = uniqueRanked(
      combined.filter((item) => item.kind === 'channel'),
      boosts,
    );
    const youtubePlaylists = uniqueRanked(
      combined.filter((item) => item.kind === 'playlist'),
      boosts,
    );
    const top: SearchResult[] = [];
    const familyCounts = new Map<string, number>();
    for (const item of combined) {
      const family = item.tab;
      if ((familyCounts.get(family) || 0) >= 3) continue;
      top.push(item);
      familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
      if (top.length >= 9) break;
    }
    for (const item of combined) {
      if (top.length >= 9) break;
      if (!top.some((candidate) => candidate.key === item.key)) top.push(item);
    }
    const external = uniqueRanked(job.results.external.filter((item) => !item.in_library), boosts);
    const related = uniqueRanked(job.results.related, boosts);
    const groups: SearchGroup[] = [];
    if (top.length > 0) groups.push({ id: 'top', label: 'Top results', layout: 'landscape', items: top, total: top.length, status: 'ready' });
    if (movies.length > 0) groups.push({ id: 'movies', label: 'Movies', layout: 'poster', items: movies, total: movies.length, status: 'ready' });
    if (series.length > 0) groups.push({ id: 'series', label: 'TV shows', layout: 'poster', items: series, total: series.length, status: 'ready' });
    if (live.length > 0) groups.push({ id: 'live', label: 'Live', layout: 'landscape', items: live, total: live.length, status: 'ready' });
    if (youtubeVideos.length > 0) groups.push({ id: 'youtube', label: 'YouTube', layout: 'landscape', items: youtubeVideos, total: youtubeVideos.length, status: 'ready' });
    if (job.snapshot.scope === 'youtube' && youtubeChannels.length > 0) {
      groups.push({ id: 'youtube_channels', label: 'Channels', layout: 'landscape', items: youtubeChannels, total: youtubeChannels.length, status: 'ready' });
    }
    if (job.snapshot.scope === 'youtube' && youtubePlaylists.length > 0) {
      groups.push({ id: 'youtube_playlists', label: 'Playlists', layout: 'landscape', items: youtubePlaylists, total: youtubePlaylists.length, status: 'ready' });
    }
    if (external.length > 0) groups.push({ id: 'external', label: 'More movies & shows', layout: 'poster', items: external, total: external.length, status: 'ready' });
    if (related.length > 0) groups.push({ id: 'related', label: 'Related to your search', layout: 'landscape', items: related, total: related.length, status: 'ready' });
    if (groups.length === 0 && job.snapshot.complete) {
      groups.push(emptyGroup('empty', 'No results', 'landscape', 'empty', 'Try another title, channel, or topic'));
    }
    job.snapshot.groups = groups;
  }

  private bump(job: SearchJob): void {
    if (job.cancelled && job.snapshot.complete) {
      job.snapshot.phases = Object.fromEntries(
        Object.entries(job.snapshot.phases).map(([key, value]) => [
          key,
          value.status === 'pending' ? phase('skipped') : value,
        ]),
      );
    }
    this.rebuildSnapshot(job);
    job.snapshot.revision += 1;
    job.snapshot.updated_at = Date.now();
    for (const wake of [...job.waiters]) wake();
  }

  private pruneJobs(): void {
    const cutoff = Date.now() - SEARCH_JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.snapshot.updated_at < cutoff) this.jobs.delete(id);
    }
    const overflow = this.jobs.size - SEARCH_JOB_LIMIT + 1;
    if (overflow <= 0) return;
    const oldest = [...this.jobs.entries()]
      .sort((a, b) => a[1].snapshot.updated_at - b[1].snapshot.updated_at)
      .slice(0, overflow);
    for (const [id] of oldest) this.jobs.delete(id);
  }
}

export function parseSearchScope(value: unknown): SearchScope {
  return value === 'movies' || value === 'series' || value === 'live' || value === 'youtube'
    ? value
    : 'all';
}

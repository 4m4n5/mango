import { collectLiveSearchEntriesFromCache } from '../live/ai-catalog-seeds.js';
import { searchArea69Index } from '../live/area69.js';
import type { CatalogCore } from '../core.js';
import { searchableChannelText, type LiveChannelMeta } from '../live-rails.js';
import {
  liveChannelHealthKey,
  queryLiveChannelHealthRecord,
  readLiveChannelHealthRegistry,
} from '../live/health.js';
import { canonicalLiveChannelKey } from '../live/qualification.js';
import { compareLiveChannelsByQuality } from '../live/quality-rank.js';
import { scoreTitleMatch, type VoiceSearchHit } from './search.js';

export type LiveSearchEntry = {
  meta: LiveChannelMeta;
  context?: string;
  source?: string;
};

type RankedLiveSearchEntry = {
  entry: LiveSearchEntry;
  hit: VoiceSearchHit;
};

export const LIVE_SEARCH_VALIDATION_BUDGET_MS = 2_000;

export type LiveSearchOptions = {
  validateUnknown?: boolean;
  validationBudgetMs?: number;
  freshnessHorizonMs?: number;
  now?: () => number;
  healthPath?: string;
  validate?: (entry: LiveSearchEntry) => Promise<boolean>;
};

const validationFlights = new Map<string, Promise<boolean>>();

export function liveSearchValidationDiagnostics(): { queued: number } {
  return { queued: validationFlights.size };
}

function buildLiveSearchText(entry: LiveSearchEntry): string {
  const parts = [searchableChannelText(entry.meta)];
  if (entry.context?.trim()) {
    parts.push(entry.context.trim());
  }
  return parts.join(' ');
}

function normalizeLiveTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function rankLiveChannelEntries(
  entries: LiveSearchEntry[],
  query: string,
  limit: number,
): VoiceSearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  return rankLiveSearchEntries(entries, query).slice(0, Math.max(1, limit)).map(({ hit }) => hit);
}

function rankLiveSearchEntries(
  entries: LiveSearchEntry[],
  query: string,
): RankedLiveSearchEntry[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const seen = new Set<string>();
  const scored: RankedLiveSearchEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.meta.id)) {
      continue;
    }
    const score = scoreTitleMatch(buildLiveSearchText(entry), trimmed);
    if (score <= 0) {
      continue;
    }
    seen.add(entry.meta.id);
    scored.push({ entry, hit: {
      type: 'tv',
      id: entry.meta.id,
      title: entry.meta.name || entry.meta.title || entry.meta.id,
      poster: entry.meta.poster,
      tab: 'live',
      score,
    } });
  }
  scored.sort((left, right) => {
    if (right.hit.score !== left.hit.score) {
      return right.hit.score - left.hit.score;
    }
    const quality = compareLiveChannelsByQuality(left.entry.meta, right.entry.meta);
    if (quality !== 0) {
      return quality;
    }
    return left.hit.title.localeCompare(right.hit.title);
  });
  return scored;
}

function entriesFromDiskCache(): LiveSearchEntry[] {
  return collectLiveSearchEntriesFromCache();
}

async function entriesFromCatalog(core: CatalogCore): Promise<LiveSearchEntry[]> {
  const channels = await core.listLiveChannelsForVoiceSearch();
  return channels.map((meta) => {
    const tagged = meta as LiveChannelMeta & { source_addon?: string; source_label?: string };
    const context = [tagged.source_label, tagged.source_addon].filter(Boolean).join(' ');
    return { meta, context: context || undefined, source: tagged.source_addon };
  });
}

function sourceForEntry(entry: LiveSearchEntry): string {
  if (entry.source?.trim()) {
    return entry.source.trim();
  }
  return entry.meta.id.startsWith('area69:') ? 'mango Live TV' : 'unknown';
}

function dedupeQualifiedResults(entries: RankedLiveSearchEntry[], limit: number): VoiceSearchHit[] {
  const seen = new Set<string>();
  const results: VoiceSearchHit[] = [];
  for (const candidate of entries) {
    const key = canonicalLiveChannelKey(candidate.entry.meta);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(candidate.hit);
    if (results.length >= Math.max(1, limit)) {
      break;
    }
  }
  return results;
}

async function waitForValidationWindow(
  promises: Promise<unknown>[],
  budgetMs: number,
): Promise<void> {
  if (promises.length === 0) {
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.allSettled(promises),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, budgetMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function searchLiveChannels(
  query: string,
  limit = 8,
  core?: CatalogCore,
  options: LiveSearchOptions = {},
): Promise<VoiceSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const byId = new Map<string, LiveSearchEntry>();
  for (const entry of entriesFromDiskCache()) {
    byId.set(entry.meta.id, entry);
  }
  if (core) {
    try {
      for (const entry of await entriesFromCatalog(core)) {
        if (!byId.has(entry.meta.id)) {
          byId.set(entry.meta.id, entry);
        }
      }
    } catch {
      // NexoTV rate limits or live config missing — disk cache still works.
    }
  }
  const entries = [...byId.values()];
  const knownTitles = new Set<string>();
  for (const entry of byId.values()) {
    knownTitles.add(
      normalizeLiveTitle(entry.meta.name || entry.meta.title || entry.meta.id),
    );
  }
  for (const hit of await searchArea69Index(trimmed, limit)) {
    const normalized = normalizeLiveTitle(hit.title);
    if (knownTitles.has(normalized)) {
      continue;
    }
    knownTitles.add(normalized);
    entries.push({
      meta: { id: hit.id, name: hit.title, title: hit.title, poster: hit.poster },
      context: 'AREA69 mango Live TV',
      source: 'mango Live TV',
    });
  }

  const ranked = rankLiveSearchEntries(entries, trimmed);
  const now = options.now?.() ?? Date.now();
  const freshnessHorizonMs = options.freshnessHorizonMs
    ?? core?.liveSearchFreshnessHorizonMs()
    ?? 0;
  const registry = await readLiveChannelHealthRegistry(options.healthPath);
  const qualified: RankedLiveSearchEntry[] = [];
  const unknown: RankedLiveSearchEntry[] = [];
  for (const candidate of ranked) {
    const health = queryLiveChannelHealthRecord(
      registry,
      sourceForEntry(candidate.entry),
      candidate.entry.meta.id,
      freshnessHorizonMs,
      now,
    );
    if (health.status === 'verified') {
      qualified.push(candidate);
    } else if (health.status === 'unknown') {
      unknown.push(candidate);
    }
  }

  if (options.validateUnknown && core && unknown.length > 0) {
    const validate = options.validate
      ?? ((entry: LiveSearchEntry) => core.validateLiveSearchEntry(entry));
    const chosen: RankedLiveSearchEntry[] = [];
    const chosenClasses = new Set<string>();
    const chosenCanonical = new Set<string>();
    for (const candidate of unknown) {
      const sourceClass = candidate.entry.meta.id.startsWith('area69:') ? 'area69' : 'free';
      const canonical = canonicalLiveChannelKey(candidate.entry.meta);
      if (chosenClasses.has(sourceClass) || chosenCanonical.has(canonical)) {
        continue;
      }
      chosenClasses.add(sourceClass);
      chosenCanonical.add(canonical);
      chosen.push(candidate);
      if (chosenClasses.size >= 2) break;
    }
    const completed = new Map<RankedLiveSearchEntry, boolean>();
    const validations = chosen.map((candidate) => {
      const source = sourceForEntry(candidate.entry);
      const flightKey = `${options.healthPath || 'default'}:${liveChannelHealthKey(
        source,
        candidate.entry.meta.id,
      )}`;
      let flight = validationFlights.get(flightKey);
      if (!flight) {
        flight = validate(candidate.entry).catch(() => false);
        validationFlights.set(flightKey, flight);
        void flight.finally(() => {
          if (validationFlights.get(flightKey) === flight) {
            validationFlights.delete(flightKey);
          }
        });
      }
      return flight.then((ok) => {
        completed.set(candidate, ok);
        return ok;
      });
    });
    await waitForValidationWindow(
      validations,
      options.validationBudgetMs ?? LIVE_SEARCH_VALIDATION_BUDGET_MS,
    );
    for (const candidate of chosen) {
      if (completed.get(candidate) === true) {
        qualified.push(candidate);
      }
    }
    // Promises that exceeded the response window intentionally continue. Their
    // health writes make a later search immediate without blocking this one.
    void Promise.allSettled(validations);
  }

  qualified.sort((left, right) => {
    if (right.hit.score !== left.hit.score) return right.hit.score - left.hit.score;
    const quality = compareLiveChannelsByQuality(left.entry.meta, right.entry.meta);
    return quality || left.hit.title.localeCompare(right.hit.title);
  });
  return dedupeQualifiedResults(qualified, limit);
}

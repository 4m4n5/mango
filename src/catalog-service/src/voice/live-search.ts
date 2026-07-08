import { collectLiveSearchEntriesFromCache } from '../live/ai-catalog-seeds.js';
import { searchArea69Index } from '../live/area69.js';
import type { CatalogCore } from '../core.js';
import { searchableChannelText, type LiveChannelMeta } from '../live-rails.js';
import { scoreTitleMatch, type VoiceSearchHit } from './search.js';

type LiveSearchEntry = {
  meta: LiveChannelMeta;
  context?: string;
};

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
  const seen = new Set<string>();
  const scored: VoiceSearchHit[] = [];
  for (const entry of entries) {
    if (seen.has(entry.meta.id)) {
      continue;
    }
    const score = scoreTitleMatch(buildLiveSearchText(entry), trimmed);
    if (score <= 0) {
      continue;
    }
    seen.add(entry.meta.id);
    scored.push({
      type: 'tv',
      id: entry.meta.id,
      title: entry.meta.name || entry.meta.title || entry.meta.id,
      poster: entry.meta.poster,
      tab: 'live',
      score,
    });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.title.localeCompare(right.title);
  });
  return scored.slice(0, Math.max(1, limit));
}

function entriesFromDiskCache(): LiveSearchEntry[] {
  return collectLiveSearchEntriesFromCache();
}

async function entriesFromCatalog(core: CatalogCore): Promise<LiveSearchEntry[]> {
  const channels = await core.listLiveChannelsForVoiceSearch();
  return channels.map((meta) => {
    const tagged = meta as LiveChannelMeta & { source_addon?: string; source_label?: string };
    const context = [tagged.source_label, tagged.source_addon].filter(Boolean).join(' ');
    return { meta, context: context || undefined };
  });
}

export async function searchLiveChannels(
  query: string,
  limit = 8,
  core?: CatalogCore,
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
  const ranked = rankLiveChannelEntries([...byId.values()], trimmed, limit);
  const knownTitles = new Set<string>();
  for (const entry of byId.values()) {
    knownTitles.add(
      normalizeLiveTitle(entry.meta.name || entry.meta.title || entry.meta.id),
    );
  }
  const merged = [...ranked];
  for (const hit of await searchArea69Index(trimmed, limit)) {
    const normalized = normalizeLiveTitle(hit.title);
    if (knownTitles.has(normalized)) {
      continue;
    }
    knownTitles.add(normalized);
    merged.push(hit);
  }
  merged.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.title.localeCompare(right.title);
  });
  return merged.slice(0, Math.max(1, limit));
}

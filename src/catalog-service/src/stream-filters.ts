import { readFile } from 'node:fs/promises';
import type { Stream } from './core.js';

export type QualityCap = '480p' | '720p' | '1080p' | '2160p';

export type StreamFilterConfig = {
  /** Drop debrid streams that look uncached (default on). */
  exclude_uncached_debrid: boolean;
  /** Also drop debrid streams when cache status is unknown (stricter). */
  strict_unknown_cache: boolean;
  /** Drop streams above this resolution (helps Pi until N7). */
  max_quality: QualityCap | null;
  /** Drop REMUX / Blu-ray remux style releases. */
  exclude_remux: boolean;
};

export type StreamFilterOverrides = {
  include_uncached?: boolean;
  strict_unknown_cache?: boolean;
  max_quality?: QualityCap | null;
  exclude_remux?: boolean;
};

export type StreamFilterMeta = {
  applied: StreamFilterConfig & { include_uncached: boolean };
  total: number;
  kept: number;
  excluded: {
    uncached_debrid: number;
    unknown_cache_debrid: number;
    above_max_quality: number;
    remux: number;
  };
};

const DEFAULT_FILTERS_PATH = '/etc/mango/catalog-filters.json';

const DEBRID_SERVICE_IDS = new Set([
  'realdebrid',
  'torbox',
  'premiumize',
  'debridlink',
  'alldebrid',
  'offcloud',
  'putio',
  'easydebrid',
  'pikpak',
]);

const QUALITY_ORDER: Record<QualityCap, number> = {
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
  '2160p': 2160,
};

function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function parseQualityCap(value: unknown): QualityCap | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).toLowerCase().replace(/\s+/g, '');
  if (normalized === '4k') return '2160p';
  if (normalized in QUALITY_ORDER) return normalized as QualityCap;
  return null;
}

function streamHaystack(stream: Stream): string {
  return `${stream.title || ''} ${stream.description || ''} ${stream.name || ''}`.toLowerCase();
}

function bingeGroup(stream: Stream): string | undefined {
  const hints = stream.behaviorHints;
  if (typeof hints !== 'object' || hints === null) return undefined;
  const group = (hints as { bingeGroup?: unknown }).bingeGroup;
  return typeof group === 'string' ? group : undefined;
}

export function debridServiceId(stream: Stream): string | null {
  const group = bingeGroup(stream);
  if (group) {
    const parts = group.split('|');
    if (parts.length >= 2) {
      const service = parts[1]?.toLowerCase();
      if (service && DEBRID_SERVICE_IDS.has(service)) return service;
    }
  }

  const haystack = streamHaystack(stream);
  if (/\breal[- ]?debrid\b|\brd\b/.test(haystack)) return 'realdebrid';
  if (/\btorbox\b|\btb\b/.test(haystack)) return 'torbox';
  if (/\bpremiumize\b/.test(haystack)) return 'premiumize';
  if (/\bdebrid\b/.test(haystack)) return 'debrid';

  try {
    const host = new URL(stream.url).hostname.toLowerCase();
    if (host.includes('real-debrid') || host.includes('realdebrid')) return 'realdebrid';
    if (host.includes('torbox')) return 'torbox';
    if (host.includes('debrid')) return 'debrid';
  } catch {
    // ignore invalid URLs
  }

  return null;
}

export function isDebridStream(stream: Stream): boolean {
  return debridServiceId(stream) !== null;
}

/** AIOStreams autoplay bingeGroup: addonId|service|cached|resolution|... */
export function parseDebridCacheStatus(stream: Stream): 'cached' | 'uncached' | 'unknown' {
  const haystack = streamHaystack(stream);
  if (/\bnot cached\b|\buncached\b/.test(haystack)) return 'uncached';
  if (/\bcached\b/.test(haystack) && !/\bnot cached\b|\buncached\b/.test(haystack)) return 'cached';

  const group = bingeGroup(stream);
  if (!group?.startsWith('com.aiostreams')) return 'unknown';

  const parts = group.split('|');
  if (parts.length < 3) return 'unknown';

  const service = parts[1]?.toLowerCase();
  if (!service || !DEBRID_SERVICE_IDS.has(service)) return 'unknown';

  const flag = parts[2]?.toLowerCase();
  if (flag === 'true') return 'cached';
  if (flag === 'false') return 'uncached';
  return 'unknown';
}

export function streamQuality(stream: Stream): QualityCap | null {
  if (stream.quality) {
    const parsed = parseQualityCap(stream.quality);
    if (parsed) return parsed;
  }
  const match = streamHaystack(stream).match(/\b(2160p|4k|1080p|720p|480p)\b/);
  return match ? parseQualityCap(match[1]) : null;
}

function isRemux(stream: Stream): boolean {
  return /\bremux\b|\bblu[- ]?ray\b.*\bremux\b/i.test(streamHaystack(stream));
}

function qualityExceedsCap(stream: Stream, cap: QualityCap | null): boolean {
  if (!cap) return false;
  const quality = streamQuality(stream);
  if (!quality) return false;
  return QUALITY_ORDER[quality] > QUALITY_ORDER[cap];
}

export function defaultFilterConfig(): StreamFilterConfig {
  return {
    exclude_uncached_debrid: !truthy(process.env.MANGO_INCLUDE_UNCACHED),
    strict_unknown_cache: truthy(process.env.MANGO_STRICT_UNKNOWN_CACHE),
    max_quality: parseQualityCap(process.env.MANGO_MAX_QUALITY),
    exclude_remux: truthy(process.env.MANGO_EXCLUDE_REMUX),
  };
}

export async function loadFilterConfig(
  path = process.env.MANGO_CATALOG_FILTERS || DEFAULT_FILTERS_PATH,
): Promise<StreamFilterConfig> {
  const base = defaultFilterConfig();
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<StreamFilterConfig> & {
      include_uncached?: boolean;
    };
    if (typeof raw.exclude_uncached_debrid === 'boolean') {
      base.exclude_uncached_debrid = raw.exclude_uncached_debrid;
    }
    if (typeof raw.strict_unknown_cache === 'boolean') {
      base.strict_unknown_cache = raw.strict_unknown_cache;
    }
    if (raw.max_quality !== undefined) {
      base.max_quality = parseQualityCap(raw.max_quality);
    }
    if (typeof raw.exclude_remux === 'boolean') {
      base.exclude_remux = raw.exclude_remux;
    }
    if (raw.include_uncached === true) {
      base.exclude_uncached_debrid = false;
    }
  } catch {
    // optional file — env defaults apply
  }
  return base;
}

export function mergeFilterConfig(
  base: StreamFilterConfig,
  overrides: StreamFilterOverrides = {},
): StreamFilterConfig & { include_uncached: boolean } {
  const includeUncached = overrides.include_uncached === true;
  return {
    exclude_uncached_debrid: includeUncached ? false : base.exclude_uncached_debrid,
    strict_unknown_cache: overrides.strict_unknown_cache ?? base.strict_unknown_cache,
    max_quality: overrides.max_quality !== undefined ? overrides.max_quality : base.max_quality,
    exclude_remux: overrides.exclude_remux ?? base.exclude_remux,
    include_uncached: includeUncached,
  };
}

export function parseFilterOverridesFromQuery(
  params: URLSearchParams,
): StreamFilterOverrides {
  const overrides: StreamFilterOverrides = {};
  if (params.has('include_uncached')) {
    overrides.include_uncached = truthy(params.get('include_uncached') || undefined);
  }
  if (params.has('strict_unknown_cache')) {
    overrides.strict_unknown_cache = truthy(params.get('strict_unknown_cache') || undefined);
  }
  if (params.has('max_quality')) {
    overrides.max_quality = parseQualityCap(params.get('max_quality'));
  }
  if (params.has('exclude_remux')) {
    overrides.exclude_remux = truthy(params.get('exclude_remux') || undefined);
  }
  return overrides;
}

function cacheRank(status: ReturnType<typeof parseDebridCacheStatus>): number {
  if (status === 'cached') return 0;
  if (status === 'unknown') return 1;
  return 2;
}

function qualityRank(stream: Stream, cap: QualityCap | null): number {
  const quality = streamQuality(stream);
  if (!quality) return 999;
  if (cap && QUALITY_ORDER[quality] > QUALITY_ORDER[cap]) return 1000;
  const target = cap ? QUALITY_ORDER[cap] : QUALITY_ORDER['1080p'];
  return Math.abs(QUALITY_ORDER[quality] - target);
}

export function filterAndRankStreams(
  streams: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
): { streams: Stream[]; meta: StreamFilterMeta } {
  const meta: StreamFilterMeta = {
    applied: config,
    total: streams.length,
    kept: 0,
    excluded: {
      uncached_debrid: 0,
      unknown_cache_debrid: 0,
      above_max_quality: 0,
      remux: 0,
    },
  };

  const kept: Stream[] = [];
  for (const stream of streams) {
    const debrid = isDebridStream(stream);
    const cacheStatus = parseDebridCacheStatus(stream);

    if (config.exclude_remux && isRemux(stream)) {
      meta.excluded.remux += 1;
      continue;
    }
    if (qualityExceedsCap(stream, config.max_quality)) {
      meta.excluded.above_max_quality += 1;
      continue;
    }
    if (debrid && config.exclude_uncached_debrid) {
      if (cacheStatus === 'uncached') {
        meta.excluded.uncached_debrid += 1;
        continue;
      }
      if (cacheStatus === 'unknown' && config.strict_unknown_cache) {
        meta.excluded.unknown_cache_debrid += 1;
        continue;
      }
    }

    kept.push({
      ...stream,
      debrid_service: debridServiceId(stream) ?? undefined,
      cache_status: cacheStatus,
    });
  }

  kept.sort((left, right) => {
    const cacheDelta = cacheRank(parseDebridCacheStatus(left)) - cacheRank(parseDebridCacheStatus(right));
    if (cacheDelta !== 0) return cacheDelta;
    return qualityRank(left, config.max_quality) - qualityRank(right, config.max_quality);
  });

  meta.kept = kept.length;
  return { streams: kept, meta };
}

export function pickPlayableStream(
  streams: Stream[],
  config: StreamFilterConfig & { include_uncached: boolean },
): { stream: Stream | null; meta: StreamFilterMeta } {
  const { streams: filtered, meta } = filterAndRankStreams(streams, config);
  return { stream: filtered[0] ?? null, meta };
}

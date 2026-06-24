import type { ListSource, CandidateMeta, ListSourceFetchStats } from './list-source.js';
import { isSourceStatsListSource } from './list-source.js';
import type { TitlePlayabilityRecord } from './db.js';
import { playabilityFailedRetryMsForReason } from './config.js';
import {
  candidateKey,
  isActiveVerifiedTitle,
  uniqueCandidates,
} from './pipeline.js';
import { isSourceCursorListSource } from './source-cursors.js';

export type IngestCandidatesStats = {
  start_offset: number;
  next_offset: number;
  scanned: number;
  fresh_queued: number;
  duplicate_candidates: number;
  skipped_verified: number;
  skipped_recent_failed: number;
  linked_verified_seen: number;
  catalog_exhausted: boolean;
  sources_touched?: number;
  source_stats?: SourceIngestStats[];
};

export type SourceIngestStats = {
  source_key: string;
  source_label: string;
  source_addon?: string;
  source_catalog?: string;
  scanned: number;
  fresh_queued: number;
  skipped_verified: number;
  skipped_recent_failed: number;
  linked_verified_seen: number;
  requested: number;
  returned: number;
  catalog_errors: number;
  rate_limited: number;
  exhausted: boolean;
};

export type IngestCandidatesResult = IngestCandidatesStats & {
  candidates: CandidateMeta[];
};

export function isRecentFailedTitle(
  title: TitlePlayabilityRecord | undefined,
  now: number,
  options?: { bypassReasons?: ReadonlySet<string> },
): boolean {
  if (!title || title.status !== 'failed') {
    return false;
  }
  const reason = title.fail_reason ?? '';
  if (options?.bypassReasons?.has(reason)) {
    return false;
  }
  return title.updated_at > now - playabilityFailedRetryMsForReason(title.fail_reason);
}

export async function ingestPaginatedCandidates(
  source: ListSource,
  options: {
    startOffset: number;
    freshTarget: number;
    pageSize: number;
    maxScanned: number;
    now?: number;
    sourceOffsets?: Map<string, number>;
    collectActiveVerified?: boolean;
    lookupTitles: (candidates: CandidateMeta[]) => Promise<Map<string, TitlePlayabilityRecord>>;
    bypassRecentFailedReasons?: ReadonlySet<string>;
    normalizeCandidate?: (candidate: CandidateMeta) => Promise<CandidateMeta>;
  },
): Promise<IngestCandidatesResult> {
  const now = options.now ?? Date.now();
  const collectActiveVerified = options.collectActiveVerified !== false;
  const collected: CandidateMeta[] = [];
  const useSourceCursors = isSourceCursorListSource(source);
  if (
    useSourceCursors
    && options.sourceOffsets
    && source.readSourceOffsets().size === 0
  ) {
    source.writeSourceOffsets(new Map(options.sourceOffsets));
  }

  let offset = Math.max(0, options.startOffset);
  let scanned = 0;
  let freshQueued = 0;
  let skippedVerified = 0;
  let skippedRecentFailed = 0;
  let linkedVerifiedSeen = 0;
  let catalogExhausted = false;
  const sourcesTouched = new Set<string>();
  const sourceStats = new Map<string, SourceIngestStats>();

  const statForCandidate = (candidate: CandidateMeta): SourceIngestStats => (
    statForSource(
      candidate.source_key ?? candidate.source ?? 'unknown',
      candidate.source ?? candidate.source_key ?? 'unknown',
    )
  );

  const statForSource = (sourceKey: string, sourceLabel: string): SourceIngestStats => {
    const existing = sourceStats.get(sourceKey);
    if (existing) {
      return existing;
    }
    const created: SourceIngestStats = {
      source_key: sourceKey,
      source_label: sourceLabel,
      scanned: 0,
      fresh_queued: 0,
      skipped_verified: 0,
      skipped_recent_failed: 0,
      linked_verified_seen: 0,
      requested: 0,
      returned: 0,
      catalog_errors: 0,
      rate_limited: 0,
      exhausted: false,
    };
    sourceStats.set(sourceKey, created);
    return created;
  };

  const mergeFetchStats = (stats: ListSourceFetchStats[]): void => {
    for (const row of stats) {
      const stat = statForSource(row.source_key, row.source_label);
      stat.requested += row.requested;
      stat.returned += row.returned;
      stat.catalog_errors += row.errors;
      stat.rate_limited += row.rate_limited;
      stat.exhausted = stat.exhausted || row.exhausted;
    }
  };

  while (scanned < options.maxScanned && freshQueued < options.freshTarget) {
    if (useSourceCursors && source.areAllSourcesExhausted()) {
      catalogExhausted = true;
      break;
    }

    const rawPage = await source.candidates({
      offset: useSourceCursors ? 0 : offset,
      limit: options.pageSize,
    });
    if (isSourceStatsListSource(source)) {
      mergeFetchStats(source.readLastSourceFetchStats());
    }
    const page = options.normalizeCandidate
      ? await Promise.all(rawPage.map((candidate) => options.normalizeCandidate?.(candidate) ?? candidate))
      : rawPage;
    if (page.length === 0) {
      catalogExhausted = !useSourceCursors || source.areAllSourcesExhausted();
      break;
    }

    const statuses = await options.lookupTitles(page);
    for (const candidate of page) {
      if (candidate.source) {
        sourcesTouched.add(candidate.source);
      }
      const sourceStat = statForCandidate(candidate);
      const key = candidateKey(candidate);
      const title = statuses.get(key);

      if (isActiveVerifiedTitle(title, now)) {
        linkedVerifiedSeen += 1;
        skippedVerified += 1;
        sourceStat.linked_verified_seen += 1;
        sourceStat.skipped_verified += 1;
        if (collectActiveVerified) {
          collected.push(candidate);
        }
        continue;
      }

      if (isRecentFailedTitle(title, now, { bypassReasons: options.bypassRecentFailedReasons })) {
        skippedRecentFailed += 1;
        sourceStat.skipped_recent_failed += 1;
        continue;
      }

      scanned += 1;
      sourceStat.scanned += 1;
      collected.push(candidate);
      freshQueued += 1;
      sourceStat.fresh_queued += 1;
      if (freshQueued >= options.freshTarget) {
        break;
      }
    }

    if (useSourceCursors) {
      if (source.areAllSourcesExhausted() && freshQueued < options.freshTarget) {
        catalogExhausted = true;
        break;
      }
      continue;
    }

    offset += page.length;
    if (page.length < options.pageSize) {
      catalogExhausted = true;
      break;
    }
  }

  const nextOffset = catalogExhausted ? 0 : offset;

  const unique = uniqueCandidates(collected);

  return {
    candidates: unique,
    start_offset: options.startOffset,
    next_offset: nextOffset,
    scanned,
    fresh_queued: freshQueued,
    duplicate_candidates: Math.max(0, collected.length - unique.length),
    skipped_verified: skippedVerified,
    skipped_recent_failed: skippedRecentFailed,
    linked_verified_seen: linkedVerifiedSeen,
    catalog_exhausted: catalogExhausted,
    sources_touched: useSourceCursors ? sourcesTouched.size : undefined,
    source_stats: sourceStats.size > 0 ? [...sourceStats.values()] : undefined,
  };
}

export function freshTargetPerRail(totalFreshTarget: number, railsNeedingWork: number): number {
  if (railsNeedingWork <= 0) {
    return totalFreshTarget;
  }
  return Math.max(8, Math.ceil(totalFreshTarget / railsNeedingWork));
}

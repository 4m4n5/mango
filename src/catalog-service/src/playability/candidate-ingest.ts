import type { ListSource, CandidateMeta } from './list-source.js';
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
  skipped_verified: number;
  skipped_recent_failed: number;
  linked_verified_seen: number;
  catalog_exhausted: boolean;
  sources_touched?: number;
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
    lookupTitles: (candidates: CandidateMeta[]) => Promise<Map<string, TitlePlayabilityRecord>>;
    bypassRecentFailedReasons?: ReadonlySet<string>;
  },
): Promise<IngestCandidatesResult> {
  const now = options.now ?? Date.now();
  const collected: CandidateMeta[] = [];
  const useSourceCursors = isSourceCursorListSource(source);
  if (useSourceCursors && options.sourceOffsets) {
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

  while (scanned < options.maxScanned && freshQueued < options.freshTarget) {
    const page = await source.candidates({
      offset: useSourceCursors ? 0 : offset,
      limit: options.pageSize,
    });
    if (page.length === 0) {
      catalogExhausted = !useSourceCursors || source.areAllSourcesExhausted();
      break;
    }

    const statuses = await options.lookupTitles(page);
    for (const candidate of page) {
      if (candidate.source) {
        sourcesTouched.add(candidate.source);
      }
      const key = candidateKey(candidate);
      const title = statuses.get(key);

      if (isActiveVerifiedTitle(title, now)) {
        linkedVerifiedSeen += 1;
        skippedVerified += 1;
        collected.push(candidate);
        continue;
      }

      if (isRecentFailedTitle(title, now, { bypassReasons: options.bypassRecentFailedReasons })) {
        skippedRecentFailed += 1;
        continue;
      }

      scanned += 1;
      collected.push(candidate);
      freshQueued += 1;
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

  return {
    candidates: uniqueCandidates(collected),
    start_offset: options.startOffset,
    next_offset: nextOffset,
    scanned,
    fresh_queued: freshQueued,
    skipped_verified: skippedVerified,
    skipped_recent_failed: skippedRecentFailed,
    linked_verified_seen: linkedVerifiedSeen,
    catalog_exhausted: catalogExhausted,
    sources_touched: useSourceCursors ? sourcesTouched.size : undefined,
  };
}

export function freshTargetPerRail(totalFreshTarget: number, railsNeedingWork: number): number {
  if (railsNeedingWork <= 0) {
    return totalFreshTarget;
  }
  return Math.max(8, Math.ceil(totalFreshTarget / railsNeedingWork));
}

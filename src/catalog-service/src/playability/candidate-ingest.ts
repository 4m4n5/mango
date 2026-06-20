import type { ListSource, CandidateMeta } from './list-source.js';
import type { TitlePlayabilityRecord } from './db.js';
import { playabilityFailedRetryMsForReason } from './config.js';
import {
  candidateKey,
  isActiveVerifiedTitle,
  uniqueCandidates,
} from './pipeline.js';

export type IngestCandidatesStats = {
  start_offset: number;
  next_offset: number;
  scanned: number;
  fresh_queued: number;
  skipped_verified: number;
  skipped_recent_failed: number;
  linked_verified_seen: number;
  catalog_exhausted: boolean;
};

export type IngestCandidatesResult = IngestCandidatesStats & {
  candidates: CandidateMeta[];
};

export function isRecentFailedTitle(
  title: TitlePlayabilityRecord | undefined,
  now: number,
): boolean {
  if (!title || title.status !== 'failed') {
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
    lookupTitles: (candidates: CandidateMeta[]) => Promise<Map<string, TitlePlayabilityRecord>>;
  },
): Promise<IngestCandidatesResult> {
  const now = options.now ?? Date.now();
  const collected: CandidateMeta[] = [];
  let offset = Math.max(0, options.startOffset);
  let scanned = 0;
  let freshQueued = 0;
  let skippedVerified = 0;
  let skippedRecentFailed = 0;
  let linkedVerifiedSeen = 0;
  let catalogExhausted = false;

  while (scanned < options.maxScanned && freshQueued < options.freshTarget) {
    const page = await source.candidates({ offset, limit: options.pageSize });
    if (page.length === 0) {
      catalogExhausted = true;
      break;
    }

    const statuses = await options.lookupTitles(page);
    for (const candidate of page) {
      scanned += 1;
      const key = candidateKey(candidate);
      const title = statuses.get(key);

      if (isActiveVerifiedTitle(title, now)) {
        linkedVerifiedSeen += 1;
        skippedVerified += 1;
        collected.push(candidate);
        continue;
      }

      if (isRecentFailedTitle(title, now)) {
        skippedRecentFailed += 1;
        continue;
      }

      collected.push(candidate);
      freshQueued += 1;
      if (freshQueued >= options.freshTarget) {
        break;
      }
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
  };
}

export function freshTargetPerRail(totalFreshTarget: number, railsNeedingWork: number): number {
  if (railsNeedingWork <= 0) {
    return totalFreshTarget;
  }
  return Math.max(8, Math.ceil(totalFreshTarget / railsNeedingWork));
}

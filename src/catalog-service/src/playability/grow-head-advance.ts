import type { IngestCandidatesStats } from './candidate-ingest.js';

/** True when the ingest page is dominated by recent-failed tombstones and no fresh candidates queued. */
export function shouldHeadAdvanceOnTombstoneSkew(
  ingested: Pick<IngestCandidatesStats, 'fresh_queued' | 'skipped_recent_failed'>,
  pageSize: number,
  ratio: number,
): boolean {
  if (ingested.fresh_queued > 0) {
    return false;
  }
  const minSkipped = Math.ceil(pageSize * ratio);
  return ingested.skipped_recent_failed >= minSkipped;
}

import { createHash } from 'node:crypto';
import { metahubPosterUrl, normalizePosterUrl } from '../poster.js';
import type { RailPoolEntry } from './db.js';
import type { CandidateMeta } from './list-source.js';

export type RailPoolDisplayPatch = Pick<
  RailPoolEntry,
  | 'title'
  | 'poster_url'
  | 'year'
  | 'evidence_json'
  | 'evidence_hash'
  | 'evidence_source'
  | 'evidence_retrieved_at'
>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Snapshot title/poster from catalog ingest for rail_pool browse cache. */
export function displaySnapshotFromCandidate(candidate: CandidateMeta): RailPoolDisplayPatch {
  const title = candidate.title?.trim() || undefined;
  const poster_url = normalizePosterUrl(candidate.poster)
    ?? metahubPosterUrl(candidate.id)
    ?? undefined;
  const year = candidate.year !== undefined && candidate.year !== null
    ? String(candidate.year)
    : undefined;
  const evidence_json = candidate.story_evidence
    ? canonicalJson(candidate.story_evidence)
    : undefined;
  return {
    title,
    poster_url,
    year,
    evidence_json,
    evidence_hash: evidence_json
      ? createHash('sha256').update(evidence_json).digest('hex')
      : undefined,
    evidence_source: candidate.source_key ?? candidate.source ?? candidate.source_name,
    evidence_retrieved_at: evidence_json ? Date.now() : undefined,
  };
}

export function mergePoolDisplayPatch(
  existing: RailPoolDisplayPatch | undefined,
  patch: RailPoolDisplayPatch,
): RailPoolDisplayPatch {
  return {
    title: patch.title ?? existing?.title,
    poster_url: patch.poster_url ?? existing?.poster_url,
    year: patch.year ?? existing?.year,
    evidence_json: patch.evidence_json ?? existing?.evidence_json,
    evidence_hash: patch.evidence_hash ?? existing?.evidence_hash,
    evidence_source: patch.evidence_source ?? existing?.evidence_source,
    evidence_retrieved_at: patch.evidence_retrieved_at ?? existing?.evidence_retrieved_at,
  };
}

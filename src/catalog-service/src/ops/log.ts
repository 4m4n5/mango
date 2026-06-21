import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { OpsEvent, OpsEventKind, OpsRailDelta } from './types.js';

function opsRoot(): string {
  const base = process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache');
  return path.join(base, 'mango', 'ops');
}

export function opsEventsPath(): string {
  return path.join(opsRoot(), 'events.jsonl');
}

function reportDirForDate(isoDate: string): string {
  return path.join(opsRoot(), 'reports', isoDate);
}

export function appendOpsEvent(
  kind: OpsEventKind,
  summary: string,
  payload: Record<string, unknown>,
  options: { run_id?: string; source?: string } = {},
): OpsEvent {
  const event: OpsEvent = {
    ts: new Date().toISOString(),
    kind,
    run_id: options.run_id,
    source: options.source ?? 'catalog-service',
    summary,
    payload,
  };
  const root = opsRoot();
  mkdirSync(root, { recursive: true });
  appendFileSync(opsEventsPath(), `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export function writeOpsRunReport(
  runId: string,
  report: Record<string, unknown>,
): string {
  const date = new Date().toISOString().slice(0, 10);
  const dir = reportDirForDate(date);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${runId}.json`);
  writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}

export function railDeltasFromTopUpResults(
  results: Array<{
    rail_id: string;
    label?: string;
    before: { verified_pool: number; pool_depth?: number };
    after: { verified_pool: number; pool_depth?: number };
    verified: number;
    failed?: number;
    candidates_seen?: number;
    exhausted?: boolean;
  }>,
): OpsRailDelta[] {
  return results.map((result) => ({
    rail_id: result.rail_id,
    label: result.label,
    verified_before: result.before.verified_pool,
    verified_after: result.after.verified_pool,
    verified_added: result.after.verified_pool - result.before.verified_pool,
    pool_before: result.before.pool_depth,
    pool_after: result.after.pool_depth,
    failed: result.failed,
    candidates_seen: result.candidates_seen,
    exhausted: result.exhausted,
  }));
}

export function summarizeRailDeltas(deltas: OpsRailDelta[]): string {
  const changed = deltas.filter((delta) => delta.verified_added !== 0);
  if (changed.length === 0) {
    return 'no verified pool changes';
  }
  return changed
    .map((delta) => `${delta.rail_id} +${delta.verified_added} (${delta.verified_before}→${delta.verified_after})`)
    .join(', ');
}

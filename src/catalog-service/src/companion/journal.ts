import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { journalPath } from './paths.js';

export type JournalEvent = {
  id: number;
  created_at: string;
  event_type: string;
  payload: Record<string, unknown>;
};

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const filePath = journalPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_events(created_at);
  `);
  dbInstance = db;
  return db;
}

export function appendJournalEvent(
  eventType: string,
  payload: Record<string, unknown>,
): JournalEvent {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO journal_events (created_at, event_type, payload) VALUES (?, ?, ?)',
  ).run(createdAt, eventType, JSON.stringify(payload));
  return {
    id: Number(result.lastInsertRowid),
    created_at: createdAt,
    event_type: eventType,
    payload,
  };
}

export function listJournalEvents(limit = 50): JournalEvent[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, created_at, event_type, payload FROM journal_events ORDER BY id DESC LIMIT ?',
  ).all(Math.max(1, Math.min(limit, 200))) as Array<{
    id: number;
    created_at: string;
    event_type: string;
    payload: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    event_type: row.event_type,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }));
}

/** True if this title was already logged as a completed watch. */
export function journalHasPlayCompleted(contentKey: string): boolean {
  const db = getDb();
  const row = db.prepare(
    `SELECT 1 AS found FROM journal_events
     WHERE event_type = 'play_completed'
       AND json_extract(payload, '$.content_key') = ?
     LIMIT 1`,
  ).get(contentKey) as { found: number } | undefined;
  return Boolean(row?.found);
}

const JOURNAL_RETENTION_DAYS = 90;
const JOURNAL_PRESERVE_TYPES = new Set([
  'nightly_consolidate',
  'journal_rollup',
  'catalog_gardener',
  'profile_patch',
]);

/** Roll up and prune raw journal events older than retention window (default 90d). */
export function rollUpJournalEvents(retentionDays = JOURNAL_RETENTION_DAYS): {
  pruned: number;
  rolled_up: Record<string, number>;
} {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const rows = db.prepare(
    `SELECT event_type, COUNT(*) AS count FROM journal_events
     WHERE created_at < ?
       AND event_type NOT IN ('nightly_consolidate', 'journal_rollup', 'catalog_gardener', 'profile_patch')
     GROUP BY event_type`,
  ).all(cutoff) as Array<{ event_type: string; count: number }>;

  const rolled_up: Record<string, number> = {};
  for (const row of rows) {
    if (row.count > 0) {
      rolled_up[row.event_type] = row.count;
    }
  }

  if (Object.keys(rolled_up).length > 0) {
    appendJournalEvent('journal_rollup', {
      cutoff,
      retention_days: retentionDays,
      counts: rolled_up,
    });
  }

  const placeholders = [...JOURNAL_PRESERVE_TYPES].map(() => '?').join(', ');
  const result = db.prepare(
    `DELETE FROM journal_events
     WHERE created_at < ?
       AND event_type NOT IN (${placeholders}, 'journal_rollup')`,
  ).run(cutoff, ...JOURNAL_PRESERVE_TYPES);

  return { pruned: Number(result.changes), rolled_up };
}

export function resetJournalForTests(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

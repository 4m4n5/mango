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

export function resetJournalForTests(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

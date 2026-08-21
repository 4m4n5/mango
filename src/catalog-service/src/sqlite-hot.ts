import type Database from 'better-sqlite3';

/** Match playability’s hot-path pragmas. Applied per connection at open. */
export const SQLITE_WAL_AUTOCHECKPOINT_PAGES = 8192;

export function applySqliteHotPragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma(`wal_autocheckpoint = ${SQLITE_WAL_AUTOCHECKPOINT_PAGES}`);
  db.pragma('cache_size = -16000');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 134217728');
}

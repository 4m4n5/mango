#!/usr/bin/env python3
"""Tests for merge_failed_grow_memory.py."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from merge_failed_grow_memory import merge_failed_grow_memory


SCHEMA = """
CREATE TABLE titles (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  verified_at INTEGER,
  expires_at INTEGER,
  fail_reason TEXT,
  best_source TEXT,
  cache_status TEXT,
  debrid_service TEXT,
  probe_ms INTEGER,
  win_url_hash TEXT,
  win_ladder_step TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (type, id)
);
CREATE TABLE rail_pool (
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  ingested_at INTEGER NOT NULL,
  PRIMARY KEY (rail_id, type, id)
);
CREATE TABLE rail_candidate_rejections (
  rail_id TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_key TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  details TEXT,
  PRIMARY KEY (rail_id, type, id)
);
CREATE TABLE verify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  rail_id TEXT,
  type TEXT NOT NULL,
  id_value TEXT NOT NULL,
  stage TEXT NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL
);
"""


def create_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn


class MergeFailedGrowMemoryTests(unittest.TestCase):
    def test_merges_failed_titles_and_rejections_without_pool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            live_path = Path(tmp) / "live.db"
            work_path = Path(tmp) / "work.db"
            live = create_db(live_path)
            work = create_db(work_path)
            work.execute(
                """
INSERT INTO titles VALUES (
  'series', 'tt_fail', 'failed', NULL, NULL, 'no_stream', NULL,
  NULL, NULL, 8000, NULL, NULL, 1500
)
""",
            )
            work.execute(
                """
INSERT INTO titles VALUES (
  'series', 'tt_verified', 'verified', 1500, 999999, NULL, 'AIOStreams',
  'cached', 'rd', 8000, 'hash', 'ideal', 1500
)
""",
            )
            work.execute(
                """
INSERT INTO rail_pool VALUES (
  'series-india-picks', 'series', 'tt_verified', 100, 1500
)
""",
            )
            work.execute(
                """
INSERT INTO rail_candidate_rejections VALUES (
  'series-india-picks', 'series', 'tt_theme', 'theme_rejected',
  'AIOMetadata:mdblist.1', 'playability-test', 1500, 999999, '{}'
)
""",
            )
            work.execute(
                """
INSERT INTO verify_log (
  started_at, rail_id, type, id_value, stage, ms, outcome
) VALUES (
  1500, 'series-india-picks', 'series', 'tt_fail', 'verify', 8000, 'no_stream'
)
""",
            )
            work.commit()
            live.close()
            work.close()

            counts = merge_failed_grow_memory(live_path, work_path, since_ms=1000, now_ms=2000)

            live = sqlite3.connect(live_path)
            try:
                self.assertEqual(counts["failed_titles"], 1)
                self.assertEqual(counts["candidate_rejections"], 1)
                self.assertEqual(counts["verify_logs"], 1)
                self.assertEqual(
                    live.execute("SELECT status, fail_reason FROM titles WHERE id='tt_fail'").fetchone(),
                    ("failed", "no_stream"),
                )
                self.assertIsNone(live.execute("SELECT 1 FROM titles WHERE id='tt_verified'").fetchone())
                self.assertIsNone(live.execute("SELECT 1 FROM rail_pool WHERE id='tt_verified'").fetchone())
                self.assertEqual(
                    live.execute(
                        "SELECT reason FROM rail_candidate_rejections WHERE id='tt_theme'",
                    ).fetchone(),
                    ("theme_rejected",),
                )
            finally:
                live.close()

    def test_does_not_overwrite_newer_live_title(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            live_path = Path(tmp) / "live.db"
            work_path = Path(tmp) / "work.db"
            live = create_db(live_path)
            work = create_db(work_path)
            live.execute(
                """
INSERT INTO titles VALUES (
  'series', 'tt_same', 'verified', 3000, 999999, NULL, 'AIOStreams',
  'cached', 'rd', 8000, 'hash', 'ideal', 3000
)
""",
            )
            work.execute(
                """
INSERT INTO titles VALUES (
  'series', 'tt_same', 'failed', NULL, NULL, 'no_stream', NULL,
  NULL, NULL, 8000, NULL, NULL, 1500
)
""",
            )
            live.commit()
            work.commit()
            live.close()
            work.close()

            counts = merge_failed_grow_memory(live_path, work_path, since_ms=1000, now_ms=2000)

            live = sqlite3.connect(live_path)
            try:
                self.assertEqual(counts["failed_titles"], 0)
                self.assertEqual(
                    live.execute("SELECT status, updated_at FROM titles WHERE id='tt_same'").fetchone(),
                    ("verified", 3000),
                )
            finally:
                live.close()


if __name__ == "__main__":
    unittest.main()

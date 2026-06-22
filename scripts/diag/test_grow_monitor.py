#!/usr/bin/env python3
"""Tests for grow_monitor.py."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from grow_monitor import (
    SCHEMA_VERSION,
    _normalize_baseline,
    build_live_status,
    fetch_verified_pool_counts,
    load_baseline,
    write_baseline,
)


class GrowMonitorTests(unittest.TestCase):
    def test_normalize_legacy_flat_baseline(self) -> None:
        raw = {
            "ts": 1000,
            "_total": 50,
            "movies-global-popular": 30,
            "series-classics": 20,
        }
        normalized = _normalize_baseline(raw)
        self.assertEqual(normalized["schema_version"], SCHEMA_VERSION)
        self.assertEqual(normalized["verified_pool"], 50)
        self.assertEqual(normalized["rails"]["movies-global-popular"], 30)

    def test_normalize_nested_baseline(self) -> None:
        raw = {
            "schema_version": 1,
            "created_at_ms": 2000,
            "verified_pool": 498,
            "rails": {"movies-global-popular": 57},
        }
        normalized = _normalize_baseline(raw)
        self.assertEqual(normalized["verified_pool"], 498)
        self.assertEqual(normalized["rails"]["movies-global-popular"], 57)

    def test_pool_counts_and_live_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "playability.db"
            conn = sqlite3.connect(db)
            conn.executescript(
                """
                CREATE TABLE titles (
                  type TEXT, id TEXT, status TEXT, verified_at INTEGER,
                  expires_at INTEGER, fail_reason TEXT, best_source TEXT,
                  cache_status TEXT, debrid_service TEXT, probe_ms INTEGER,
                  win_url_hash TEXT, win_ladder_step TEXT, updated_at INTEGER,
                  PRIMARY KEY (type, id)
                );
                CREATE TABLE rail_pool (
                  rail_id TEXT, type TEXT, id TEXT, score INTEGER,
                  ingested_at INTEGER, title TEXT, poster_url TEXT, year TEXT,
                  PRIMARY KEY (rail_id, type, id)
                );
                INSERT INTO titles VALUES (
                  'movie','tt1','verified',0,999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-global-popular','movie','tt1',100,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            counts = fetch_verified_pool_counts(db)
            self.assertEqual(counts.total, 1)
            self.assertEqual(counts.rails["movies-global-popular"], 1)

            baseline = {
                "schema_version": 1,
                "created_at_ms": 0,
                "verified_pool": 0,
                "rails": {"movies-global-popular": 0},
            }
            status = build_live_status(baseline, catalog={}, db_file=db)
            self.assertEqual(status["verified_pool"], 1)
            self.assertEqual(status["verified_pool_delta"], 1)
            rail = status["rails"][0]
            self.assertEqual(rail["pool_growth"], 1)

    def test_write_and_load_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "playability.db"
            baseline_file = Path(tmp) / "grow-baseline.json"
            conn = sqlite3.connect(db)
            conn.executescript(
                """
                CREATE TABLE titles (
                  type TEXT, id TEXT, status TEXT, verified_at INTEGER,
                  expires_at INTEGER, fail_reason TEXT, best_source TEXT,
                  cache_status TEXT, debrid_service TEXT, probe_ms INTEGER,
                  win_url_hash TEXT, win_ladder_step TEXT, updated_at INTEGER,
                  PRIMARY KEY (type, id)
                );
                CREATE TABLE rail_pool (
                  rail_id TEXT, type TEXT, id TEXT, score INTEGER,
                  ingested_at INTEGER, title TEXT, poster_url TEXT, year TEXT,
                  PRIMARY KEY (rail_id, type, id)
                );
                INSERT INTO titles VALUES (
                  'movie','tt2','verified',0,999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-comedy','movie','tt2',100,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            import os

            os.environ["MANGO_PLAYABILITY_DB"] = str(db)
            os.environ["MANGO_GROW_BASELINE"] = str(baseline_file)
            try:
                written = write_baseline(db)
                self.assertEqual(written["verified_pool"], 1)
                loaded = load_baseline()
                assert loaded is not None
                self.assertEqual(loaded["rails"]["movies-comedy"], 1)
            finally:
                os.environ.pop("MANGO_PLAYABILITY_DB", None)
                os.environ.pop("MANGO_GROW_BASELINE", None)


if __name__ == "__main__":
    unittest.main()

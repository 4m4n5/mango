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
    _format_phase_line,
    _normalize_baseline,
    assess_refresh_json,
    build_live_status,
    fetch_unique_verified_library_count,
    fetch_verified_pool_counts,
    format_live_status,
    load_baseline,
    write_baseline,
)
from ops_grow_sla import list_grow_rail_ids


class GrowMonitorTests(unittest.TestCase):
    def test_normalize_legacy_flat_baseline(self) -> None:
        raw = {
            "ts": 1000,
            "_total": 50,
            "movies-global-popular": 30,
            "series-classics": 20,
            "popular-global": 7,
        }
        normalized = _normalize_baseline(raw)
        self.assertEqual(normalized["schema_version"], SCHEMA_VERSION)
        self.assertIn("grow_rail_ids", normalized)
        self.assertNotIn("popular-global", normalized["rails"])

    def test_normalize_nested_baseline(self) -> None:
        raw = {
            "schema_version": 2,
            "created_at_ms": 2000,
            "verified_pool": 498,
            "grow_rail_ids": ["movies-global-popular", "ai-horror"],
            "rails": {"movies-global-popular": 57, "ai-horror": 32},
        }
        normalized = _normalize_baseline(raw)
        self.assertEqual(normalized["verified_pool"], 89)
        self.assertEqual(normalized["rails"]["ai-horror"], 32)

    def test_fetch_excludes_expired_verified(self) -> None:
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
                  'movie','fresh','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO titles VALUES (
                  'movie','stale','verified',0,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-documentaries','movie','fresh',100,0,NULL,NULL,NULL
                );
                INSERT INTO rail_pool VALUES (
                  'movies-documentaries','movie','stale',90,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            counts = fetch_verified_pool_counts(db, now_ms=1000)
            self.assertEqual(counts.rails.get("movies-documentaries"), 1)

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
                  'movie','tt1','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-global-popular','movie','tt1',100,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            counts = fetch_verified_pool_counts(db)
            self.assertEqual(counts.total, 1)

            grow_ids = ["movies-global-popular", "ai-horror"]
            baseline = {
                "schema_version": 2,
                "created_at_ms": 0,
                "verified_pool": 0,
                "grow_rail_ids": grow_ids,
                "rails": {"movies-global-popular": 0, "ai-horror": 0},
            }
            status = build_live_status(baseline, catalog={}, db_file=db)
            self.assertEqual(status["rails_total"], 2)
            self.assertEqual(status["verified_pool"], 1)
            self.assertEqual(status["verified_pool_delta"], 1)
            self.assertEqual(status["rails"][0]["rail_id"], "movies-global-popular")
            self.assertEqual(status["rails"][1]["rail_id"], "ai-horror")
            self.assertEqual(status["rails"][1]["pool_growth"], 0)

            text = format_live_status(status)
            self.assertIn("ai-horror", text)
            self.assertIn("movies-global-popular", text)

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
                  'movie','tt2','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-comedy','movie','tt2',100,0,NULL,NULL,NULL
                );
                INSERT INTO rail_pool VALUES (
                  'popular-global','movie','tt2',100,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            import os

            os.environ["MANGO_PLAYABILITY_DB"] = str(db)
            os.environ["MANGO_GROW_BASELINE"] = str(baseline_file)
            os.environ["MANGO_CATALOG_YAML"] = str(Path(tmp) / "missing.yaml")
            try:
                written = write_baseline(db)
                self.assertNotIn("popular-global", written["rails"])
                self.assertIn("grow_rail_ids", written)
                loaded = load_baseline()
                assert loaded is not None
                self.assertEqual(loaded["grow_rail_ids"], written["grow_rail_ids"])
            finally:
                os.environ.pop("MANGO_PLAYABILITY_DB", None)
                os.environ.pop("MANGO_GROW_BASELINE", None)
                os.environ.pop("MANGO_CATALOG_YAML", None)

    def test_format_phase_line_preflight_progress(self) -> None:
        line = _format_phase_line({
            "phase": "preflight",
            "phase_message": "probing sources",
            "run_state": {"preflight_done": 5, "preflight_total": 36},
        })
        assert line is not None
        self.assertIn("preflight", line)
        self.assertIn("5/36", line)

    def test_fetch_unique_verified_excludes_expired(self) -> None:
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
                INSERT INTO titles VALUES (
                  'movie','fresh','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO titles VALUES (
                  'movie','stale','verified',0,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO titles VALUES (
                  'movie','pending','pending',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                """,
            )
            conn.close()
            self.assertEqual(fetch_unique_verified_library_count(db, now_ms=1000), 1)

    def test_baseline_stores_unique_verified(self) -> None:
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
                  'movie','tt3','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO titles VALUES (
                  'movie','tt4','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-comedy','movie','tt3',100,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            import os

            os.environ["MANGO_PLAYABILITY_DB"] = str(db)
            os.environ["MANGO_GROW_BASELINE"] = str(baseline_file)
            os.environ["MANGO_CATALOG_YAML"] = str(Path(tmp) / "missing.yaml")
            try:
                written = write_baseline(db)
                self.assertEqual(written["unique_verified"], 2)
                normalized = _normalize_baseline(written)
                self.assertEqual(normalized["unique_verified"], 2)
            finally:
                os.environ.pop("MANGO_PLAYABILITY_DB", None)
                os.environ.pop("MANGO_GROW_BASELINE", None)
                os.environ.pop("MANGO_CATALOG_YAML", None)

    def test_live_status_shows_unique_line(self) -> None:
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
                  'movie','tt5','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-global-popular','movie','tt5',100,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            baseline = {
                "schema_version": 2,
                "created_at_ms": 0,
                "verified_pool": 0,
                "unique_verified": 0,
                "grow_rail_ids": ["movies-global-popular"],
                "rails": {"movies-global-popular": 0},
            }
            status = build_live_status(baseline, catalog={}, db_file=db)
            self.assertEqual(status["unique_verified"], 1)
            self.assertEqual(status["unique_verified_delta"], 1)
            text = format_live_status(status)
            self.assertIn("unique: 1 titles (+1 since baseline)", text)
            self.assertIn("pool slots:", text)

    def test_assess_refresh_json_unique_library(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "refresh-playability-test.json"
            path.write_text(
                json.dumps({
                    "mode": "grow",
                    "unique_verified_before": 900,
                    "unique_verified_after": 904,
                    "unique_verified_delta": 4,
                    "rails": [
                        {
                            "rail_id": "movies-global-popular",
                            "fresh_verified": 22,
                            "grow_target": 20,
                            "verified_before": 141,
                            "verified_after": 174,
                        },
                    ],
                }),
                encoding="utf-8",
            )
            text = assess_refresh_json(path)
            self.assertIn("unique library: 904 titles (+4 this run, was 900)", text)

    def test_list_grow_rail_ids_orders_ai_last(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            catalog = Path(tmp) / "catalog.yaml"
            ai_dir = Path(tmp) / "ai-catalogs"
            slots_dir = ai_dir / "slots"
            slots_dir.mkdir(parents=True)
            catalog.write_text(
                """
rails:
  - id: movies-global-popular
    enabled: true
    type: composite_list
    playability: { display_limit: 9, grow_per_pass: 20 }
  - id: featured-global
    enabled: false
    type: addon_catalog
    playability: { display_limit: 9, grow_per_pass: 20 }
""",
                encoding="utf-8",
            )
            (ai_dir / "slots" / "horror.yaml").write_text(
                "slot_id: horror\nenabled: true\nplayability:\n  grow_per_pass: 20\n",
                encoding="utf-8",
            )
            import os

            os.environ["MANGO_CATALOG_YAML"] = str(catalog)
            os.environ["MANGO_AI_CATALOGS_DIR"] = str(ai_dir)
            try:
                ids = list_grow_rail_ids()
                self.assertEqual(ids[-1], "ai-horror")
                self.assertNotIn("featured-global", ids)
            finally:
                os.environ.pop("MANGO_CATALOG_YAML", None)
                os.environ.pop("MANGO_AI_CATALOGS_DIR", None)


if __name__ == "__main__":
    unittest.main()

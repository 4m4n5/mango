#!/usr/bin/env python3
"""Tests for grow_monitor.py."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import fcntl
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from grow_monitor import (
    SCHEMA_VERSION,
    _count_active_probes,
    _filter_own_process_tree,
    _format_phase_line,
    _lock_file_active,
    _normalize_baseline,
    assess_refresh_json,
    build_live_status,
    cmd_assess,
    fetch_orphan_verified_library_count,
    fetch_overlap_summary,
    fetch_unique_verified_library_count,
    fetch_verified_pool_counts,
    format_live_status,
    load_baseline,
    write_baseline,
)
from ops_grow_sla import list_grow_rail_ids


class GrowMonitorTests(unittest.TestCase):
    def test_stale_lock_file_is_not_active(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "playability-maintenance.lock"
            lock.touch()
            self.assertFalse(_lock_file_active(lock))

            with lock.open("a+", encoding="utf-8") as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                try:
                    self.assertTrue(_lock_file_active(lock))
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def test_count_active_probes_counts_timeout_wrappers_only(self) -> None:
        lines = [
            "100 timeout --kill-after=3 33 /home/aman/mango/scripts/m3-play/playability/mpv-probe-ipc.sh --worker-id 0",
            "101 bash /home/aman/mango/scripts/m3-play/playability/mpv-probe-ipc.sh --worker-id 0",
            "102 bash /home/aman/mango/scripts/m3-play/playability/mpv-probe-ipc.sh --worker-id 0",
            "200 timeout --kill-after=3 33 /home/aman/mango/scripts/m3-play/playability/mpv-probe-ipc.sh --worker-id 1",
        ]
        with patch("grow_monitor._pgrep", return_value=lines):
            self.assertEqual(_count_active_probes(), 2)

    def test_process_filter_drops_monitor_parent_commands(self) -> None:
        lines = [
            "100 bash -c cd ~/mango && python3 scripts/diag/grow_monitor.py status && pgrep -af playability-indexer.ts",
            "200 node scripts/m3-play/playability/playability-indexer.ts --mode grow",
        ]
        self.assertEqual(
            _filter_own_process_tree(lines, own_pids={100, 999}),
            ["200 node scripts/m3-play/playability/playability-indexer.ts --mode grow"],
        )

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

    def test_fetch_includes_expired_verified_as_published(self) -> None:
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
            self.assertEqual(counts.rails.get("movies-documentaries"), 2)

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
                "grow_per_pass": 5,
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
            self.assertEqual(status["rails"][0]["grow_target"], 5)

            text = format_live_status(status)
            self.assertIn("ai-horror", text)
            self.assertIn("movies-global-popular", text)
            self.assertIn("orphans:", text)

    def test_orphan_and_overlap_audit_counts(self) -> None:
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
                  'movie','orphan','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO titles VALUES (
                  'movie','shared','verified',0,9999999999999,NULL,NULL,NULL,NULL,NULL,NULL,NULL,0
                );
                INSERT INTO rail_pool VALUES (
                  'movies-comedy','movie','shared',100,0,NULL,NULL,NULL
                );
                INSERT INTO rail_pool VALUES (
                  'movies-classics','movie','shared',90,0,NULL,NULL,NULL
                );
                INSERT INTO rail_pool VALUES (
                  'movies-global-popular','movie','shared',80,0,NULL,NULL,NULL
                );
                """,
            )
            conn.close()

            self.assertEqual(fetch_orphan_verified_library_count(db), 1)
            overlap = fetch_overlap_summary(db, max_rails_per_title=2)
            self.assertEqual(overlap["overlapped_titles"], 1)
            self.assertEqual(overlap["over_cap_titles"], 1)
            self.assertEqual(overlap["overlap_extra_slots"], 1)
            self.assertEqual(overlap["max_rails_per_title"], 3)

    def test_live_status_clamps_probe_successes_to_pool_growth(self) -> None:
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
                CREATE TABLE verify_log (
                  started_at INTEGER, rail_id TEXT, type TEXT, id_value TEXT,
                  stage TEXT, ms INTEGER, outcome TEXT
                );
                """
            )
            for index in range(9):
                conn.execute(
                    "INSERT INTO titles VALUES ('series', ?, 'verified', 0, 9999999999999, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0)",
                    (f"tt{index}",),
                )
                conn.execute(
                    "INSERT INTO rail_pool VALUES ('series-classics', 'series', ?, 100, 0, NULL, NULL, NULL)",
                    (f"tt{index}",),
                )
            for index in range(70):
                conn.execute(
                    "INSERT INTO verify_log VALUES (2000, 'series-classics', 'series', ?, 'verify', 1, 'verified')",
                    (f"tt-log-{index}",),
                )
            conn.commit()
            conn.close()

            baseline = {
                "schema_version": 2,
                "created_at_ms": 1000,
                "verified_pool": 8,
                "unique_verified": 8,
                "grow_rail_ids": ["series-classics"],
                "rails": {"series-classics": 8},
            }
            status = build_live_status(baseline, catalog={}, db_file=db)
            rail = status["rails"][0]
            self.assertEqual(rail["pool_growth"], 1)
            self.assertEqual(rail["verify_stats"]["verified"], 70)
            self.assertEqual(rail["fresh_verified"], 1)
            self.assertFalse(rail["grow_target_met"])

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

    def test_format_includes_probe_and_thin_rails(self) -> None:
        text = format_live_status({
            "baseline_path": "/tmp/grow-baseline.json",
            "unique_verified": 100,
            "unique_verified_before": 90,
            "unique_verified_delta": 10,
            "verified_pool": 50,
            "verified_pool_delta": 5,
            "rails_met_target": 1,
            "rails_total": 2,
            "program_pass_rate": 0.5,
            "verify_since_baseline": {"verified": 3, "failed": 1, "total": 4},
            "grow": {
                "running": True,
                "overnight": {"running": True, "pid": 99, "log": "/tmp/overnight-fill.log"},
                "couch_up": False,
                "active_probes": 2,
            },
            "rails": [],
            "thin_rails": [{
                "rail_id": "movies-classics",
                "verified": 3,
                "pool_target": 20,
                "fill_pct": 15,
                "alert": False,
            }],
        })
        self.assertIn("probes since baseline: 3 verified, 1 failed (4 total)", text)
        self.assertIn("thin rails (<50% pool_target):", text)
        self.assertIn("movies-classics: 3/20 (15%)", text)
        self.assertIn("overnight: yes pid=99", text)

    def test_fetch_unique_verified_includes_expired_published_rows(self) -> None:
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
            self.assertEqual(fetch_unique_verified_library_count(db, now_ms=1000), 2)

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
            os.environ["MANGO_GROW_PER_PASS"] = "5"
            try:
                written = write_baseline(db)
                self.assertEqual(written["unique_verified"], 2)
                self.assertEqual(written["grow_per_pass"], 5)
                normalized = _normalize_baseline(written)
                self.assertEqual(normalized["unique_verified"], 2)
                self.assertEqual(normalized["grow_per_pass"], 5)
            finally:
                os.environ.pop("MANGO_PLAYABILITY_DB", None)
                os.environ.pop("MANGO_GROW_BASELINE", None)
                os.environ.pop("MANGO_CATALOG_YAML", None)
                os.environ.pop("MANGO_GROW_PER_PASS", None)

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

    def test_assess_refresh_json_formats_structured_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "refresh-playability-failed.json"
            path.write_text(
                json.dumps({
                    "ok": False,
                    "mode": "grow",
                    "duration_ms": 123,
                    "stage": "core_boot",
                    "failure_category": "rate_limited",
                    "error": "Too many addon requests with your token, please slow down.",
                    "repair_suggestions": [
                        "Use playability VOD boot or stagger addon access.",
                    ],
                    "rails": [],
                }),
                encoding="utf-8",
            )
            text = assess_refresh_json(path)
            self.assertIn("refresh failed: rate_limited stage=core_boot", text)
            self.assertIn("repair suggestions:", text)

    def test_assess_does_not_mask_current_baseline_with_older_success(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / "cache"
            ops = cache / "mango" / "ops"
            ops.mkdir(parents=True)
            baseline_file = root / "grow-baseline.json"
            baseline_file.write_text(
                json.dumps({
                    "schema_version": 2,
                    "created_at_ms": 2_000_000,
                    "grow_rail_ids": ["movies-global-popular"],
                    "unique_verified": 100,
                    "rails": {"movies-global-popular": 10},
                }),
                encoding="utf-8",
            )
            old_report = ops / "refresh-playability-old.json"
            old_report.write_text(
                json.dumps({
                    "mode": "grow",
                    "rails": [
                        {
                            "rail_id": "movies-global-popular",
                            "fresh_verified": 20,
                            "grow_target": 20,
                            "verified_before": 10,
                            "verified_after": 30,
                        },
                    ],
                }),
                encoding="utf-8",
            )
            os.utime(old_report, (1, 1))
            (cache / "mango" / "grow-run-state.json").write_text(
                json.dumps({
                    "run_id": "playability-test",
                    "phase": "done",
                    "message": "aborted - couch restore",
                }),
                encoding="utf-8",
            )

            old_env = {
                "XDG_CACHE_HOME": os.environ.get("XDG_CACHE_HOME"),
                "MANGO_GROW_BASELINE": os.environ.get("MANGO_GROW_BASELINE"),
            }
            os.environ["XDG_CACHE_HOME"] = str(cache)
            os.environ["MANGO_GROW_BASELINE"] = str(baseline_file)
            try:
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    rc = cmd_assess(argparse.Namespace(refresh_json=None, json=False))
                self.assertEqual(rc, 1)
                text = out.getvalue()
                self.assertIn("no refresh-playability JSON found after grow baseline", text)
                self.assertIn("grow_aborted", text)
                self.assertIn("ignored older refresh JSON", text)
            finally:
                for key, value in old_env.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value

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

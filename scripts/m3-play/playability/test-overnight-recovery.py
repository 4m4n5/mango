#!/usr/bin/env python3
"""Tests for the bounded overnight recovery supervisor."""

from __future__ import annotations

import datetime as dt
import importlib.util
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts/m3-play/playability/overnight-recovery.py"
SPEC = importlib.util.spec_from_file_location("overnight_recovery", MODULE_PATH)
assert SPEC and SPEC.loader
overnight_recovery = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = overnight_recovery
SPEC.loader.exec_module(overnight_recovery)


class OvernightRecoveryTests(unittest.TestCase):
    def test_canonical_counts_exclude_episode_rows_and_track_expiry_lkg(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "playability.db"
            conn = sqlite3.connect(db)
            conn.executescript(
                """
CREATE TABLE titles (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  verified_at INTEGER,
  first_verified_at INTEGER,
  expires_at INTEGER,
  fail_reason TEXT,
  best_source TEXT,
  cache_status TEXT,
  debrid_service TEXT,
  probe_ms INTEGER,
  win_url_hash TEXT,
  proof_version INTEGER NOT NULL DEFAULT 1,
  proof_run_id TEXT,
  proof_exact_main INTEGER NOT NULL DEFAULT 0,
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
                """,
            )
            rows = [
                ("movie", "ttfresh", "verified", 1000, 1000, 9_999_999, None, 2000),
                ("series", "tt1234567", "stale", 1000, 1000, 100, "expired_stale", 2000),
                ("series", "tt1234567:2:1", "verified", 1000, 1000, 9_999_999, None, 2000),
                ("movie", "ttfailed", "failed", None, None, None, "no_stream", 2000),
            ]
            conn.executemany(
                """
INSERT INTO titles(type,id,status,verified_at,first_verified_at,expires_at,fail_reason,updated_at)
VALUES(?,?,?,?,?,?,?,?)
                """,
                rows,
            )
            conn.executemany(
                "INSERT INTO rail_pool(rail_id,type,id,score,ingested_at) VALUES(?,?,?,?,?)",
                [
                    ("r1", "movie", "ttfresh", 1, 1),
                    ("r2", "series", "tt1234567", 1, 1),
                    ("r2", "series", "tt1234567:2:1", 1, 1),
                ],
            )
            conn.commit()
            conn.close()
            counts = overnight_recovery.sqlite_count(db, 1_000)
            self.assertTrue(counts["available"])
            self.assertEqual(counts["series_episode_rows_excluded_from_canonical"], 1)
            self.assertEqual(counts["canonical"]["fresh"], 1)
            self.assertEqual(counts["canonical"]["visible"], 2)
            self.assertEqual(counts["canonical"]["expiry_only_visible"], 1)

    def test_phase_selection_keeps_stale_heavier_than_grow(self) -> None:
        self.assertEqual(overnight_recovery.choose_phase(0, 0, 0.8), "stale")
        self.assertEqual(overnight_recovery.choose_phase(45 * 60, 0, 0.8), "grow")
        self.assertEqual(overnight_recovery.choose_phase(45 * 60, 45 * 60, 0.8), "stale")

    def test_scheduled_guard_expires_without_supervisor_cleanup(self) -> None:
        with mock.patch.object(overnight_recovery.time, "time", return_value=10):
            self.assertEqual(overnight_recovery.main(["--scheduled-guard", "--until-ms", "11000"]), 1)
            self.assertEqual(overnight_recovery.main(["--scheduled-guard", "--until-ms", "10000"]), 0)

    def test_last_pass_cannot_extend_absolute_window(self) -> None:
        now = dt.datetime(2026, 9, 12, 11, 20, tzinfo=dt.timezone.utc)
        admission = now + dt.timedelta(minutes=10)
        finish = now + dt.timedelta(minutes=40)
        plan = overnight_recovery.build_pass_plan(
            repo_dir=ROOT, phase="stale", now=now,
            admission_stop=admission, finish_at=finish,
            max_pass_minutes=45, restore_reserve_minutes=5,
        )
        self.assertIsNotNone(plan)
        self.assertLessEqual(plan.absolute_admission_deadline_ms, overnight_recovery.ms_from_dt(admission))
        self.assertLessEqual(plan.absolute_run_deadline_ms, overnight_recovery.ms_from_dt(finish))

    def test_pass_env_is_recovery_only_and_never_quick(self) -> None:
        now = dt.datetime(2026, 9, 12, 4, 0, tzinfo=dt.timezone.utc)
        plan = overnight_recovery.build_pass_plan(
            repo_dir=ROOT,
            phase="grow",
            now=now,
            admission_stop=now + dt.timedelta(hours=2),
            finish_at=now + dt.timedelta(hours=3),
            max_pass_minutes=45,
            restore_reserve_minutes=5,
        )
        self.assertIsNotNone(plan)
        env = overnight_recovery.pass_env({}, plan, ROOT)
        self.assertEqual(env["MANGO_GROW_PRESET"], "nightly")
        self.assertEqual(env["MANGO_MAINTENANCE_SKIP_GATE"], "1")
        self.assertEqual(env["MANGO_SYNC_AIOMETADATA"], "0")
        self.assertEqual(env["MANGO_SOURCE_HITRATE_PREFLIGHT"], "0")
        self.assertEqual(env["MANGO_NIGHTLY_YOUTUBE_REFRESH"], "0")
        self.assertEqual(env["MANGO_NIGHTLY_RELIABILITY_PROOF"], "0")
        self.assertIn("MANGO_PLAYABILITY_ABSOLUTE_RUN_DEADLINE_MS", env)
        self.assertIn("MANGO_PLAYABILITY_ABSOLUTE_ADMISSION_DEADLINE_MS", env)

    def test_runtime_condition_guard_restores_after_failure(self) -> None:
        calls: list[list[str]] = []

        def fake_runner(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, "", "")

        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp) / "runtime"
            marker = Path(tmp) / "guard"
            guard = overnight_recovery.RuntimeScheduledServiceGuard(
                runtime_dir=runtime,
                script_path=MODULE_PATH,
                until_ms=123456,
                services=("mango-playability-indexer.service", "mango-companion-nightly.service"),
                runner=fake_runner,
            )
            guard.install()
            dropin = runtime / "systemd/user/mango-playability-indexer.service.d/overnight-recovery.conf"
            self.assertTrue(dropin.exists())
            text = dropin.read_text(encoding="utf-8")
            self.assertIn("--scheduled-guard --until-ms 123456", text)
            self.assertNotIn("ExecCondition=\nExecCondition=", text)
            restored = guard.restore()
            self.assertFalse(dropin.exists())
            self.assertEqual(restored["errors"], [])
            self.assertEqual(calls, [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "daemon-reload"]])

    def test_runtime_guard_refuses_to_overwrite_existing_dropin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp) / "runtime"
            dropin_dir = runtime / "systemd/user/mango-playability-indexer.service.d"
            dropin_dir.mkdir(parents=True)
            (dropin_dir / "overnight-recovery.conf").write_text("existing\n", encoding="utf-8")
            guard = overnight_recovery.RuntimeScheduledServiceGuard(
                runtime_dir=runtime,
                script_path=MODULE_PATH,
                until_ms=123456,
                services=("mango-playability-indexer.service",),
                runner=lambda *_args, **_kwargs: subprocess.CompletedProcess([], 0, "", ""),
            )
            with self.assertRaises(overnight_recovery.SupervisorError):
                guard.install()

    def test_main_lifecycle_success_partial_busy_and_failure_receipts(self) -> None:
        class FakeGuard:
            def __init__(self, **_kwargs: Any) -> None:
                pass

            def install(self, dry_run: bool = False) -> dict[str, Any]:
                return {"installed": True}

            def restore(self) -> dict[str, Any]:
                return {"removed": ["dropin"], "errors": []}

        class FakePopen:
            returncode = 0

            def __init__(self, _cmd: list[str], **_kwargs: Any) -> None:
                self.pid = 4242

            def poll(self) -> int:
                return self.returncode

        def run_case(returncode: int) -> dict[str, Any]:
            with tempfile.TemporaryDirectory() as tmp:
                cache = Path(tmp) / "cache" / "mango"
                plan = overnight_recovery.PassPlan(
                    phase="stale",
                    preset="nightly",
                    run_id="playability-overnight-stale-test",
                    level="stale_refresh",
                    deadline_minutes=30,
                    admission_minutes=5,
                    absolute_run_deadline_ms=2,
                    absolute_admission_deadline_ms=1,
                    command=["true"],
                )
                FakePopen.returncode = returncode
                if returncode != 75:
                    run_dir = cache / "playability-runs"
                    run_dir.mkdir(parents=True)
                    state = "succeeded" if returncode == 0 else "partial"
                    overnight_recovery.atomic_write_json(
                        run_dir / f"{plan.run_id}.json",
                        {"run_id": plan.run_id, "state": state},
                    )
                with (
                    mock.patch.object(overnight_recovery, "sqlite_count", return_value={"available": True, "canonical": {"fresh": 1, "visible": 2, "expiry_only_visible": 1}}),
                    mock.patch.object(overnight_recovery, "git_sha", return_value="abc123def456"),
                    mock.patch.object(overnight_recovery, "RuntimeScheduledServiceGuard", FakeGuard),
                    mock.patch.object(overnight_recovery, "build_pass_plan", side_effect=[plan, None]),
                    mock.patch.object(overnight_recovery.subprocess, "Popen", FakePopen),
                    mock.patch.object(overnight_recovery, "enqueue_recommendation_refresh", return_value={"ok": True, "job_count": 2}),
                    mock.patch.object(overnight_recovery.time, "sleep", return_value=None),
                ):
                    rc = overnight_recovery.main([
                        "--finish-at", "2099-09-12T08:00:00-04:00",
                        "--admission-stop-at", "2099-09-12T07:30:00-04:00",
                        "--repo-dir", str(ROOT),
                        "--cache-dir", str(cache),
                        "--db", str(Path(tmp) / "playability.db"),
                        "--run-id", "overnight-recovery-test",
                        "--pass-cooldown-seconds", "0",
                    ])
                receipt = overnight_recovery.load_receipt(cache / "ops/overnight-recovery-test.json")
                self.assertEqual(rc, 0)
                return receipt

        success = run_case(0)["passes"][0]
        self.assertEqual(success["outcome"], "succeeded")
        self.assertEqual(success["no_gain_streak"], 1)
        self.assertEqual(success["cooldown_seconds"], 120)
        self.assertEqual(run_case(10)["passes"][0]["outcome"], "partial")
        self.assertEqual(run_case(75)["passes"][0]["outcome"], "busy")

        class FailingGuard(FakeGuard):
            def install(self, dry_run: bool = False) -> dict[str, Any]:
                raise overnight_recovery.SupervisorError("boom")

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache" / "mango"
            with (
                mock.patch.object(overnight_recovery, "sqlite_count", return_value={"available": True}),
                mock.patch.object(overnight_recovery, "git_sha", return_value="abc123def456"),
                mock.patch.object(overnight_recovery, "RuntimeScheduledServiceGuard", FailingGuard),
            ):
                rc = overnight_recovery.main([
                    "--finish-at", "2099-09-12T08:00:00-04:00",
                    "--admission-stop-at", "2099-09-12T07:30:00-04:00",
                    "--repo-dir", str(ROOT),
                    "--cache-dir", str(cache),
                    "--db", str(Path(tmp) / "playability.db"),
                    "--run-id", "overnight-recovery-fail",
                ])
            receipt = overnight_recovery.load_receipt(cache / "ops/overnight-recovery-fail.json")
            self.assertEqual(rc, 1)
            self.assertEqual(receipt["state"], "failed")
            self.assertEqual(receipt["timer_restore"]["errors"], [])

    def test_restore_error_and_child_overdue_are_not_complete(self) -> None:
        class RestoreErrorGuard:
            def __init__(self, **_kwargs: Any) -> None:
                pass

            def install(self, dry_run: bool = False) -> dict[str, Any]:
                return {"installed": True}

            def restore(self) -> dict[str, Any]:
                return {"removed": [], "errors": ["daemon_reload:failed"]}

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache" / "mango"
            with (
                mock.patch.object(overnight_recovery, "sqlite_count", return_value={"available": True}),
                mock.patch.object(overnight_recovery, "git_sha", return_value="abc123def456"),
                mock.patch.object(overnight_recovery, "RuntimeScheduledServiceGuard", RestoreErrorGuard),
                mock.patch.object(overnight_recovery, "build_pass_plan", return_value=None),
            ):
                rc = overnight_recovery.main([
                    "--finish-at", "2099-09-12T08:00:00-04:00",
                    "--admission-stop-at", "2099-09-12T07:30:00-04:00",
                    "--repo-dir", str(ROOT),
                    "--cache-dir", str(cache),
                    "--db", str(Path(tmp) / "playability.db"),
                    "--run-id", "overnight-recovery-restore-error",
                ])
            receipt = overnight_recovery.load_receipt(cache / "ops/overnight-recovery-restore-error.json")
            self.assertEqual(rc, 1)
            self.assertNotEqual(receipt["state"], "complete")
            self.assertEqual(receipt["failure"], "timer_restore_failed")

        class ImmediatePopen:
            def __init__(self, _cmd: list[str], **_kwargs: Any) -> None:
                self.pid = 5252

            def poll(self) -> int:
                return 0

        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / "cache" / "mango"
            plan = overnight_recovery.PassPlan(
                phase="stale",
                preset="nightly",
                run_id="playability-overnight-overdue",
                level="stale_refresh",
                deadline_minutes=30,
                admission_minutes=5,
                absolute_run_deadline_ms=2,
                absolute_admission_deadline_ms=1,
                command=["true"],
            )
            run_dir = cache / "playability-runs"
            run_dir.mkdir(parents=True)
            overnight_recovery.atomic_write_json(
                run_dir / f"{plan.run_id}.json",
                {"run_id": plan.run_id, "state": "succeeded"},
            )
            before = dt.datetime(2099, 9, 12, 11, 20, tzinfo=dt.timezone.utc)
            after = dt.datetime(2099, 9, 12, 12, 1, tzinfo=dt.timezone.utc)
            with (
                mock.patch.object(overnight_recovery, "sqlite_count", return_value={"available": True}),
                mock.patch.object(overnight_recovery, "git_sha", return_value="abc123def456"),
                mock.patch.object(overnight_recovery, "RuntimeScheduledServiceGuard", RestoreErrorGuard),
                mock.patch.object(overnight_recovery, "build_pass_plan", return_value=plan),
                mock.patch.object(overnight_recovery.subprocess, "Popen", ImmediatePopen),
                mock.patch.object(overnight_recovery, "now_utc", side_effect=[before, before, after, after, after, after]),
                mock.patch.object(overnight_recovery.time, "sleep", return_value=None),
            ):
                rc = overnight_recovery.main([
                    "--finish-at", "2099-09-12T08:00:00-04:00",
                    "--admission-stop-at", "2099-09-12T07:30:00-04:00",
                    "--repo-dir", str(ROOT),
                    "--cache-dir", str(cache),
                    "--db", str(Path(tmp) / "playability.db"),
                    "--run-id", "overnight-recovery-overdue",
                ])
            receipt = overnight_recovery.load_receipt(cache / "ops/overnight-recovery-overdue.json")
            self.assertEqual(rc, 1)
            self.assertNotEqual(receipt["state"], "complete")
            self.assertTrue(receipt["passes"][0]["child_overdue"])


if __name__ == "__main__":
    unittest.main()

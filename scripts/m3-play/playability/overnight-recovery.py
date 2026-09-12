#!/usr/bin/env python3
"""Absolute-deadline overnight recovery supervisor for playability maintenance.

This wrapper intentionally owns only orchestration.  It does not edit
playability DB rows, provider configuration, cursors, or service code.  Each
work pass enters the existing playability coordinator, and this process writes a
durable operator receipt with before/progress/after canonical title counts.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import shlex
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


DEFAULT_TIMER_GUARD_SERVICES = (
    "mango-playability-indexer.service",
    "mango-youtube-runtime-refresh.service",
    "mango-companion-nightly.service",
)


class SupervisorError(RuntimeError):
    pass


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def local_tz() -> dt.tzinfo:
    return dt.datetime.now().astimezone().tzinfo or dt.timezone.utc


def parse_datetime(value: str, *, base: dt.datetime | None = None) -> dt.datetime:
    raw = value.strip()
    if not raw:
        raise argparse.ArgumentTypeError("empty datetime")
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    if len(raw) == 5 and raw[2] == ":":
        hour, minute = [int(part) for part in raw.split(":", 1)]
        reference = base or dt.datetime.now(local_tz())
        candidate = reference.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= reference:
            candidate += dt.timedelta(days=1)
        return candidate.astimezone(dt.timezone.utc)
    try:
        parsed = dt.datetime.fromisoformat(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"invalid datetime: {value}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=local_tz())
    return parsed.astimezone(dt.timezone.utc)


def ms_from_dt(value: dt.datetime) -> int:
    return int(value.timestamp() * 1000)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        with contextlib.suppress(FileNotFoundError):
            tmp.unlink()


def sqlite_count(db_path: Path, now_ms: int) -> dict[str, Any]:
    unavailable = {
        "available": False,
        "db_path": str(db_path),
        "error": "not_found",
    }
    if not db_path.exists():
        return unavailable

    visible_predicate = """
      (
        status = 'verified'
        OR (
          status = 'stale'
          AND fail_reason = 'expired_stale'
          AND verified_at IS NOT NULL
          AND verified_at > 0
          AND expires_at IS NOT NULL
          AND expires_at <= :now
        )
      )
    """
    fresh_predicate = """
      (status = 'verified' AND expires_at IS NOT NULL AND expires_at > :now)
    """
    canonical_title_predicate = """
      type IN ('movie', 'series') AND instr(id, char(58)) = 0
    """
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error as exc:
        return {**unavailable, "error": f"open_failed:{exc.__class__.__name__}"}
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        title_rows = int(conn.execute("SELECT COUNT(*) FROM titles").fetchone()[0])
        rail_rows = int(conn.execute("SELECT COUNT(*) FROM rail_pool").fetchone()[0])
        episode_rows = int(
            conn.execute(
                """
SELECT COUNT(*) FROM titles
WHERE type = 'series'
  AND lower(id) GLOB 'tt[0-9]*:[0-9]*:[0-9]*'
  AND instr(id, char(58)) > 0
                """,
            ).fetchone()[0],
        )
        status_rows = {
            str(row["status"]): int(row["count"])
            for row in conn.execute(
                "SELECT status, COUNT(*) AS count FROM titles GROUP BY status",
            )
        }
        canonical_fresh = int(
            conn.execute(
                f"""
SELECT COUNT(*) FROM titles
WHERE {canonical_title_predicate} AND {fresh_predicate}
                """,
                {"now": now_ms},
            ).fetchone()[0],
        )
        canonical_visible = int(
            conn.execute(
                f"""
SELECT COUNT(*) FROM titles
WHERE {canonical_title_predicate} AND {visible_predicate}
                """,
                {"now": now_ms},
            ).fetchone()[0],
        )
        canonical_expiry_only = int(
            conn.execute(
                f"""
SELECT COUNT(*) FROM titles
WHERE {canonical_title_predicate}
  AND {visible_predicate}
  AND NOT {fresh_predicate}
                """,
                {"now": now_ms},
            ).fetchone()[0],
        )
        visible_rail_rows = int(
            conn.execute(
                f"""
SELECT COUNT(*)
FROM rail_pool rp
JOIN titles t ON t.type = rp.type AND t.id = rp.id
WHERE {visible_predicate.replace('status', 't.status').replace('fail_reason', 't.fail_reason').replace('verified_at', 't.verified_at').replace('expires_at', 't.expires_at')}
                """,
                {"now": now_ms},
            ).fetchone()[0],
        )
        return {
            "available": True,
            "db_path": str(db_path),
            "title_rows": title_rows,
            "rail_pool_rows": rail_rows,
            "visible_rail_pool_rows": visible_rail_rows,
            "series_episode_rows_excluded_from_canonical": episode_rows,
            "status_rows": status_rows,
            "canonical": {
                "fresh": canonical_fresh,
                "visible": canonical_visible,
                "expiry_only_visible": canonical_expiry_only,
            },
        }
    except sqlite3.Error as exc:
        return {**unavailable, "error": f"query_failed:{exc.__class__.__name__}"}
    finally:
        conn.close()


@dataclass
class PassPlan:
    phase: str
    preset: str
    run_id: str
    level: str
    deadline_minutes: int
    admission_minutes: int
    absolute_run_deadline_ms: int
    absolute_admission_deadline_ms: int
    command: list[str]


def choose_phase(stale_seconds: float, grow_seconds: float, stale_weight: float) -> str:
    total = stale_seconds + grow_seconds
    if total <= 0:
        return "stale"
    target_stale = total * stale_weight
    target_grow = total * (1.0 - stale_weight)
    stale_deficit = target_stale - stale_seconds
    grow_deficit = target_grow - grow_seconds
    return "stale" if stale_deficit >= grow_deficit else "grow"


def build_pass_plan(
    *,
    repo_dir: Path,
    phase: str,
    now: dt.datetime,
    admission_stop: dt.datetime,
    finish_at: dt.datetime,
    max_pass_minutes: int,
    restore_reserve_minutes: int,
) -> PassPlan | None:
    remaining_to_admission = max(0, int((admission_stop - now).total_seconds() // 60))
    remaining_to_finish = max(0, int((finish_at - now).total_seconds() // 60))
    if remaining_to_admission < 5 or remaining_to_finish < 10:
        return None
    deadline_minutes = max(30, min(max_pass_minutes, max(30, remaining_to_finish - restore_reserve_minutes)))
    admission_minutes = max(1, min(deadline_minutes - 5, remaining_to_admission))
    if deadline_minutes <= admission_minutes:
        return None
    preset = "nightly"
    mode = "stale" if phase == "stale" else "grow"
    level = "stale_refresh" if phase == "stale" else "grow_standard"
    run_id = f"playability-overnight-{phase}-{uuid.uuid4()}"
    command = [
        "bash",
        str(repo_dir / "scripts/m3-play/playability/playability-coordinator.sh"),
        "--run-id",
        run_id,
        "--level",
        level,
    ]
    return PassPlan(
        phase=phase,
        preset=preset,
        run_id=run_id,
        level=level,
        deadline_minutes=deadline_minutes,
        admission_minutes=admission_minutes,
        absolute_run_deadline_ms=ms_from_dt(min(finish_at, now + dt.timedelta(minutes=deadline_minutes))),
        absolute_admission_deadline_ms=ms_from_dt(min(admission_stop, now + dt.timedelta(minutes=admission_minutes))),
        command=command,
    )


def pass_env(base: dict[str, str], plan: PassPlan, repo_dir: Path, cache_dir: Path | None = None) -> dict[str, str]:
    env = dict(base)
    if cache_dir is not None and cache_dir.name == "mango":
        env["XDG_CACHE_HOME"] = str(cache_dir.parent)
    updates = {
            "MANGO_REPO_DIR": str(repo_dir),
            "MANGO_OVERNIGHT_RECOVERY_RUN_ID": base.get("MANGO_OVERNIGHT_RECOVERY_RUN_ID", ""),
            "MANGO_SYNC_AIOMETADATA": "0",
            "MANGO_SOURCE_HITRATE_PREFLIGHT": "0",
            "MANGO_MAINTENANCE_SKIP_GATE": "1",
            "MANGO_MAINTENANCE_HOOKS_PRESTAGE": "1" if plan.phase == "stale" else "0",
            "MANGO_PLAYABILITY_STALE_CANDIDATE_LIMIT": base.get("MANGO_PLAYABILITY_STALE_CANDIDATE_LIMIT", "1000"),
            "MANGO_NIGHTLY_YOUTUBE_REFRESH": "0",
            "MANGO_NIGHTLY_RELIABILITY_PROOF": "0",
            "MANGO_NIGHTLY_SESSION_RESHUFFLE": "0",
            "MANGO_GROW_PRESET": plan.preset,
            "MANGO_PLAYABILITY_REFRESH_MODE": plan.phase,
            "MANGO_PLAYABILITY_NIGHTLY_DEADLINE_MINUTES": str(plan.deadline_minutes),
            "MANGO_PLAYABILITY_ADMISSION_STOP_MINUTES": str(plan.admission_minutes),
            "MANGO_PLAYABILITY_ABSOLUTE_RUN_DEADLINE_MS": str(plan.absolute_run_deadline_ms),
            "MANGO_PLAYABILITY_ABSOLUTE_ADMISSION_DEADLINE_MS": str(plan.absolute_admission_deadline_ms),
    }
    if "MANGO_PLAYABILITY_DB" in base:
        updates["MANGO_PLAYABILITY_DB"] = base["MANGO_PLAYABILITY_DB"]
    env.update(updates)
    return env


def classify_pass_outcome(child_rc: int, coordinator_receipt: dict[str, Any], expected_run_id: str) -> str:
    if child_rc == 75:
        return "busy"
    if child_rc not in (0, 10):
        return "failed"
    if coordinator_receipt.get("run_id") != expected_run_id:
        return "missing_coordinator_receipt"
    state = coordinator_receipt.get("state")
    if state == "succeeded":
        return "succeeded"
    if state == "partial":
        return "partial"
    if state == "failed":
        return "failed"
    return "unknown_coordinator_state"


class RuntimeScheduledServiceGuard:
    def __init__(
        self,
        *,
        runtime_dir: Path,
        script_path: Path,
        until_ms: int,
        services: Iterable[str],
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ) -> None:
        self.runtime_dir = runtime_dir
        self.script_path = script_path
        self.until_ms = until_ms
        self.services = tuple(services)
        self.runner = runner
        self.dropins: list[Path] = []
        self.installed = False

    def install(self, dry_run: bool = False) -> dict[str, Any]:
        if dry_run:
            return {
                "installed": False,
                "dry_run": True,
                "until_ms": self.until_ms,
                "services": list(self.services),
            }
        for service in self.services:
            if "/" in service or not service.endswith(".service"):
                raise SupervisorError(f"invalid guarded service: {service}")
            dropin_dir = self.runtime_dir / "systemd/user" / f"{service}.d"
            dropin_dir.mkdir(parents=True, exist_ok=True)
            dropin = dropin_dir / "overnight-recovery.conf"
            if dropin.exists():
                raise SupervisorError(f"refusing to overwrite existing runtime drop-in: {dropin}")
            dropin.write_text(
                "[Service]\n"
                f"ExecCondition={shlex.quote(sys.executable)} {shlex.quote(str(self.script_path))} "
                f"--scheduled-guard --until-ms {self.until_ms}\n",
                encoding="utf-8",
            )
            self.dropins.append(dropin)
        self.runner(["systemctl", "--user", "daemon-reload"], check=True, text=True)
        self.installed = True
        return {
            "installed": True,
            "until_ms": self.until_ms,
            "dropins": [str(path) for path in self.dropins],
            "services": list(self.services),
        }

    def restore(self) -> dict[str, Any]:
        removed: list[str] = []
        errors: list[str] = []
        for dropin in self.dropins:
            try:
                dropin.unlink()
                removed.append(str(dropin))
                with contextlib.suppress(OSError):
                    dropin.parent.rmdir()
            except FileNotFoundError:
                pass
            except OSError as exc:
                errors.append(f"{dropin}:{exc}")
        if self.installed or self.dropins:
            try:
                self.runner(["systemctl", "--user", "daemon-reload"], check=True, text=True)
            except Exception as exc:  # noqa: BLE001 - report, do not hide result receipt
                errors.append(f"daemon_reload:{exc}")
        return {"removed": removed, "errors": errors}


def emit_systemd_run(args: argparse.Namespace, script_path: Path) -> str:
    cmd = [
        "systemd-run",
        "--user",
        "--unit",
        args.unit_name,
        "--description",
        "Mango overnight recovery supervisor",
        "--property",
        "Type=exec",
        "--property",
        "KillMode=process",
        "--property",
        "SendSIGKILL=no",
        "--property",
        "TimeoutStopSec=infinity",
        sys.executable,
        str(script_path),
        "--finish-at",
        args.finish_at_raw,
        "--admission-stop-at",
        args.admission_stop_at_raw,
        "--repo-dir",
        str(args.repo_dir),
        "--cache-dir",
        str(args.cache_dir),
        "--db",
        str(args.db),
    ]
    if args.max_pass_minutes != 45:
        cmd += ["--max-pass-minutes", str(args.max_pass_minutes)]
    return " ".join(shlex.quote(part) for part in cmd)


def load_receipt(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def enqueue_recommendation_refresh(catalog_url: str, reason: str) -> dict[str, Any]:
    payload = json.dumps({"reason": reason})
    try:
        result = subprocess.run(
            [
                "curl",
                "-fsS",
                "-m",
                "10",
                "-X",
                "POST",
                "-H",
                "content-type: application/json",
                "--data",
                payload,
                f"{catalog_url.rstrip('/')}/recommendations/refresh",
            ],
            capture_output=True,
            text=True,
            timeout=12,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "status": "warning", "message": "enqueue_request_failed", "error": exc.__class__.__name__}
    if result.returncode != 0:
        return {"ok": False, "status": "warning", "message": "enqueue_request_failed", "returncode": result.returncode}
    try:
        body = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "status": "warning", "message": "invalid_enqueue_response"}
    jobs = body.get("jobs") if isinstance(body, dict) else None
    if not isinstance(body, dict) or body.get("ok") is not True or not isinstance(jobs, list) or not jobs:
        return {"ok": False, "status": "warning", "message": "invalid_enqueue_response"}
    content_types = sorted({str(job.get("content_type") or "") for job in jobs if isinstance(job, dict) and job.get("content_type")})
    return {
        "ok": True,
        "status": "queued",
        "message": "worker_async",
        "job_count": len(jobs),
        "content_types": content_types,
    }


def git_sha(repo_dir: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_dir), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SupervisorError(f"git HEAD unavailable: {exc.__class__.__name__}") from exc
    value = (result.stdout or "").strip()
    if len(value) < 12:
        raise SupervisorError("git HEAD unavailable")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scheduled-guard", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--until-ms", type=int, default=0, help=argparse.SUPPRESS)
    parser.add_argument("--finish-at", dest="finish_at_raw", default=os.environ.get("MANGO_OVERNIGHT_FINISH_AT", "08:00"))
    parser.add_argument(
        "--admission-stop-at",
        dest="admission_stop_at_raw",
        default=os.environ.get("MANGO_OVERNIGHT_ADMISSION_STOP_AT", "07:30"),
    )
    parser.add_argument("--repo-dir", type=Path, default=Path(os.environ.get("MANGO_REPO_DIR", Path.cwd())))
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "mango",
    )
    parser.add_argument("--db", type=Path, default=Path(os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db")))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--print-systemd-run", action="store_true")
    parser.add_argument("--skip-final-recommendations-refresh", action="store_true")
    parser.add_argument("--catalog-url", default=os.environ.get("MANGO_CATALOG_URL", "http://127.0.0.1:3020"))
    parser.add_argument("--run-id", default=f"overnight-recovery-{uuid.uuid4()}")
    parser.add_argument("--stale-weight", type=float, default=0.80)
    parser.add_argument("--max-pass-minutes", type=int, default=45)
    parser.add_argument("--restore-reserve-minutes", type=int, default=5)
    parser.add_argument("--pass-cooldown-seconds", type=int, default=60)
    parser.add_argument("--unit-name", default="mango-overnight-recovery")
    parser.add_argument(
        "--guard-service",
        action="append",
        dest="guard_services",
        default=None,
        help="systemd user service to skip through a runtime ExecCondition; repeatable",
    )
    args = parser.parse_args(argv)

    if args.scheduled_guard:
        return 1 if int(time.time() * 1000) < args.until_ms else 0

    if not (0.5 <= args.stale_weight <= 0.9):
        raise SystemExit("--stale-weight must be between 0.5 and 0.9")
    if args.max_pass_minutes < 30:
        raise SystemExit("--max-pass-minutes must be at least 30 so maintenance keeps the requested bound")

    reference = dt.datetime.now(local_tz())
    finish_at = parse_datetime(args.finish_at_raw, base=reference)
    admission_stop = parse_datetime(args.admission_stop_at_raw, base=reference)
    if admission_stop >= finish_at:
        raise SystemExit("--admission-stop-at must be before --finish-at")

    args.repo_dir = args.repo_dir.resolve()
    args.cache_dir = args.cache_dir.expanduser()
    args.db = args.db.expanduser()
    if args.cache_dir.name != "mango":
        raise SystemExit("--cache-dir must point at the Mango cache directory ending in /mango")
    script_path = Path(__file__).resolve()

    if args.print_systemd_run:
        print(emit_systemd_run(args, script_path))
        return 0

    ops_dir = args.cache_dir / "ops"
    receipt_path = ops_dir / f"{args.run_id}.json"
    lock_path = args.cache_dir / "playability-runs" / "overnight-recovery.lock"
    runtime_dir = Path(os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    services = tuple(args.guard_services or DEFAULT_TIMER_GUARD_SERVICES)
    started = now_utc()
    starting_sha = git_sha(args.repo_dir)
    baseline = sqlite_count(args.db, ms_from_dt(started))
    if not args.dry_run and not baseline.get("available"):
        raise SystemExit(f"playability baseline unavailable: {baseline.get('error')}")
    receipt: dict[str, Any] = {
        "schema_version": 1,
        "run_id": args.run_id,
        "state": "dry_run" if args.dry_run else "running",
        "started_at": started.isoformat(),
        "finish_at": finish_at.isoformat(),
        "admission_stop_at": admission_stop.isoformat(),
        "stale_weight": args.stale_weight,
        "max_pass_minutes": args.max_pass_minutes,
        "git_sha": starting_sha,
        "baseline": baseline,
        "passes": [],
    }

    if args.dry_run:
        now = now_utc()
        stale_seconds = 0.0
        grow_seconds = 0.0
        dry_passes: list[dict[str, Any]] = []
        while True:
            phase = choose_phase(stale_seconds, grow_seconds, args.stale_weight)
            plan = build_pass_plan(
                repo_dir=args.repo_dir,
                phase=phase,
                now=now,
                admission_stop=admission_stop,
                finish_at=finish_at,
                max_pass_minutes=args.max_pass_minutes,
                restore_reserve_minutes=args.restore_reserve_minutes,
            )
            if plan is None:
                break
            dry_passes.append(
                {
                    "phase": phase,
                    "deadline_minutes": plan.deadline_minutes,
                    "admission_minutes": plan.admission_minutes,
                    "command": plan.command,
                },
            )
            if phase == "stale":
                stale_seconds += plan.deadline_minutes * 60
            else:
                grow_seconds += plan.deadline_minutes * 60
            now += dt.timedelta(minutes=plan.deadline_minutes)
            if len(dry_passes) >= 32:
                break
        receipt["planned_passes"] = dry_passes
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0

    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("overnight-recovery: already running", file=sys.stderr)
        return 75

    stop_requested = False

    def _stop(_signum: int, _frame: Any) -> None:
        nonlocal stop_requested
        stop_requested = True

    old_term = signal.signal(signal.SIGTERM, _stop)
    old_int = signal.signal(signal.SIGINT, _stop)
    guard = RuntimeScheduledServiceGuard(
        runtime_dir=runtime_dir,
        script_path=script_path,
        until_ms=ms_from_dt(finish_at),
        services=services,
    )
    rc = 1
    try:
        guard_result = guard.install(dry_run=False)
        receipt["timer_guard"] = guard_result
        atomic_write_json(receipt_path, receipt)
        rc = 0
        stale_seconds = 0.0
        grow_seconds = 0.0
        no_gain_passes = {"stale": 0, "grow": 0}
        while not stop_requested:
            current = now_utc()
            if current >= admission_stop:
                receipt["state"] = "admission_closed"
                break
            # Recovery remains primary, but stop spending every pass in a lane
            # that is not returning fresh titles while discovery is productive.
            weight = 0.5 if no_gain_passes["stale"] >= 2 and no_gain_passes["grow"] == 0 else args.stale_weight
            phase = choose_phase(stale_seconds, grow_seconds, weight)
            plan = build_pass_plan(
                repo_dir=args.repo_dir,
                phase=phase,
                now=current,
                admission_stop=admission_stop,
                finish_at=finish_at,
                max_pass_minutes=args.max_pass_minutes,
                restore_reserve_minutes=args.restore_reserve_minutes,
            )
            if plan is None:
                receipt["state"] = "admission_closed"
                break
            pass_record: dict[str, Any] = {
                "phase": plan.phase,
                "preset": plan.preset,
                "run_id": plan.run_id,
                "level": plan.level,
                "started_at": current.isoformat(),
                "deadline_minutes": plan.deadline_minutes,
                "admission_minutes": plan.admission_minutes,
                "absolute_run_deadline_ms": plan.absolute_run_deadline_ms,
                "absolute_admission_deadline_ms": plan.absolute_admission_deadline_ms,
                "command": plan.command,
                "before": sqlite_count(args.db, ms_from_dt(current)),
            }
            receipt["passes"].append(pass_record)
            atomic_write_json(receipt_path, receipt)
            current_sha = git_sha(args.repo_dir)
            if current_sha != starting_sha:
                pass_record["skipped"] = True
                pass_record["skip_reason"] = "git_sha_drift"
                receipt["state"] = "failed"
                receipt["failure"] = "git_sha_drift"
                rc = 1
                break
            started_monotonic = time.monotonic()
            pass_base_env = dict(os.environ)
            pass_base_env["MANGO_OVERNIGHT_RECOVERY_RUN_ID"] = args.run_id
            pass_base_env["MANGO_PLAYABILITY_DB"] = str(args.db)
            env = pass_env(pass_base_env, plan, args.repo_dir, args.cache_dir)
            process = subprocess.Popen(plan.command, cwd=args.repo_dir, env=env, text=True)
            pass_record["child_pid"] = process.pid
            atomic_write_json(receipt_path, receipt)
            while True:
                child_rc = process.poll()
                if child_rc is not None:
                    break
                pass_record["heartbeat_at"] = now_utc().isoformat()
                if now_utc() > finish_at:
                    pass_record["child_overdue"] = True
                    pass_record["child_overdue_at"] = now_utc().isoformat()
                atomic_write_json(receipt_path, receipt)
                time.sleep(30)
            elapsed = max(0.0, time.monotonic() - started_monotonic)
            if plan.phase == "stale":
                stale_seconds += elapsed
            else:
                grow_seconds += elapsed
            coordinator_receipt = load_receipt(args.cache_dir / "playability-runs" / f"{plan.run_id}.json")
            outcome = classify_pass_outcome(child_rc, coordinator_receipt, plan.run_id)
            pass_record.update(
                {
                    "finished_at": now_utc().isoformat(),
                    "elapsed_seconds": round(elapsed, 3),
                    "returncode": child_rc,
                    "outcome": outcome,
                    "coordinator_receipt_state": coordinator_receipt.get("state"),
                    "after": sqlite_count(args.db, ms_from_dt(now_utc())),
                },
            )
            try:
                pass_record["git_sha_after"] = git_sha(args.repo_dir)
            except SupervisorError as exc:
                pass_record["git_sha_after_error"] = str(exc)
            if pass_record.get("git_sha_after") not in (None, starting_sha):
                receipt["state"] = "failed"
                receipt["failure"] = "git_sha_drift"
                rc = 1
                atomic_write_json(receipt_path, receipt)
                break
            if now_utc() > finish_at:
                pass_record["child_overdue"] = True
                receipt["state"] = "partial"
                receipt["failure"] = "child_finished_after_absolute_deadline"
                rc = 1
                atomic_write_json(receipt_path, receipt)
                break
            atomic_write_json(receipt_path, receipt)
            if outcome in {"failed", "missing_coordinator_receipt", "unknown_coordinator_state"}:
                receipt["state"] = "failed"
                receipt["failure"] = f"pass_{outcome}"
                rc = 1
                break
            before_fresh = pass_record["before"].get("canonical", {}).get("fresh", 0)
            after_fresh = pass_record["after"].get("canonical", {}).get("fresh", 0)
            gain = after_fresh - before_fresh
            no_gain_passes[phase] = 0 if gain > 0 else no_gain_passes[phase] + 1
            cooldown = max(0, args.pass_cooldown_seconds)
            if no_gain_passes[phase]:
                cooldown = max(cooldown, min(480, 60 * 2 ** min(no_gain_passes[phase], 3)))
            pass_record["fresh_count_delta"] = gain
            pass_record["no_gain_streak"] = no_gain_passes[phase]
            pass_record["cooldown_seconds"] = cooldown
            atomic_write_json(receipt_path, receipt)
            remaining_cooldown = min(cooldown, max(0, (admission_stop - now_utc()).total_seconds()))
            while not stop_requested and remaining_cooldown > 0:
                interval = min(30, remaining_cooldown)
                time.sleep(interval)
                remaining_cooldown -= interval
        else:
            receipt["state"] = "stopping"
            rc = 130
        if rc == 0 and receipt.get("state") in {"running", "admission_closed"}:
            receipt["state"] = "complete"
        if rc == 0 and not args.skip_final_recommendations_refresh:
            receipt["final_recommendation_refresh"] = enqueue_recommendation_refresh(
                args.catalog_url,
                "overnight_recovery_final",
            )
            atomic_write_json(receipt_path, receipt)
    except Exception as exc:  # noqa: BLE001 - durable failure receipt plus restoration
        rc = 1 if rc == 0 else rc
        receipt["state"] = "failed"
        receipt["failure"] = exc.__class__.__name__
        receipt["failure_message"] = str(exc)
    finally:
        restore_result = guard.restore()
        finished = now_utc()
        latest = dict(receipt)
        latest.update(
            {
                "finished_at": finished.isoformat(),
                "result": sqlite_count(args.db, ms_from_dt(finished)),
                "timer_restore": restore_result,
            },
        )
        if latest.get("state") == "running":
            latest["state"] = "failed" if rc else "complete"
        if restore_result.get("errors"):
            latest["state"] = "partial" if latest.get("state") == "complete" else "failed"
            latest["failure"] = "timer_restore_failed"
            rc = 1
        atomic_write_json(receipt_path, latest)
        signal.signal(signal.SIGTERM, old_term)
        signal.signal(signal.SIGINT, old_int)
        with contextlib.suppress(OSError):
            os.close(lock_fd)
    print(f"overnight-recovery: receipt={receipt_path} state={load_receipt(receipt_path).get('state')}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())

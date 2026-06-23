#!/usr/bin/env python3
"""Unified Library Grower monitoring — baseline, live status, watch, post-run assess."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Import SLA helpers from sibling module (scripts/diag is on sys.path when run as script).
from ops_grow_sla import (  # noqa: E402
    PROGRAM_PASS_RATE,
    RailPlayabilityConfig,
    assess_rail_sla,
    collect_grow_rail_rows,
    format_grow_sla_section,
    list_grow_rail_ids,
    load_catalog_playability,
    resolve_grow_target,
    summarize_grow_sla,
)

SCHEMA_VERSION = 2
DEFAULT_BASELINE = "grow-baseline.json"
GROW_INDEXER_PATTERN = "playability-indexer.ts"
REFRESH_JSON_GLOB = "refresh-playability-*.json"


def cache_dir() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "mango"


def baseline_path() -> Path:
    override = os.environ.get("MANGO_GROW_BASELINE")
    if override:
        return Path(override).expanduser()
    return cache_dir() / DEFAULT_BASELINE


def db_path() -> Path:
    return Path(os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db"))


def pidfile_path() -> Path:
    return cache_dir() / "playability-grow.pid"


def maintenance_lock_path() -> Path:
    return cache_dir() / "playability-maintenance.lock"


def grow_log_path() -> Path:
    return cache_dir() / "playability-grow.log"


def ops_dir() -> Path:
    return cache_dir() / "ops"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _pgrep(pattern: str) -> list[str]:
    try:
        result = subprocess.run(
            ["pgrep", "-af", pattern],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    return lines


def grow_run_state_path() -> Path:
    return cache_dir() / "grow-run-state.json"


def load_grow_run_state() -> dict[str, Any] | None:
    path = grow_run_state_path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def detect_grow_state() -> dict[str, Any]:
    pidfile = pidfile_path()
    pid: int | None = None
    if pidfile.is_file():
        try:
            pid = int(pidfile.read_text(encoding="utf-8").strip())
        except ValueError:
            pid = None

    pid_alive = pid is not None and _pid_alive(pid)
    if pidfile.is_file() and not pid_alive:
        try:
            pidfile.unlink()
        except OSError:
            pass
        pid = None

    lock_held = maintenance_lock_path().is_file()
    indexer_lines = _pgrep(GROW_INDEXER_PATTERN)
    topup_lines = _pgrep("playability-top-up-rail.sh")
    maintenance_lines = [
        line for line in _pgrep("playability-maintenance.sh")
        if "--mode" in line
    ]
    hitrate_lines = _pgrep("source-hitrate.py")

    run_state = load_grow_run_state()
    phase = run_state.get("phase") if run_state else None
    phase_message = run_state.get("message") if run_state else None

    running = pid_alive or bool(indexer_lines) or bool(topup_lines) or bool(maintenance_lines) or bool(hitrate_lines)
    if phase and phase not in {"done", "idle"} and (pid_alive or maintenance_lines or hitrate_lines or topup_lines):
        running = True

    return {
        "running": running,
        "pid": pid if pid_alive else None,
        "pidfile": str(pidfile),
        "maintenance_lock": lock_held,
        "indexer": indexer_lines[:3],
        "topup": topup_lines[:2],
        "maintenance": maintenance_lines[:2],
        "hitrate": hitrate_lines[:2],
        "phase": phase,
        "phase_message": phase_message,
        "run_state": run_state,
        "log": str(grow_log_path()) if grow_log_path().is_file() else _latest_grow_log(),
    }


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _latest_grow_log() -> str | None:
    candidates = sorted(
        [*ops_dir().glob("maintenance-playability-*.log"), *ops_dir().glob("grow-*.log")],
        key=lambda path: path.stat().st_mtime,
    )
    return str(candidates[-1]) if candidates else None


def _latest_refresh_json(after_ms: int | None = None) -> Path | None:
    files = sorted(
        ops_dir().glob(REFRESH_JSON_GLOB),
        key=lambda path: path.stat().st_mtime,
    )
    if after_ms is not None:
        files = [path for path in files if int(path.stat().st_mtime * 1000) >= after_ms]
    return files[-1] if files else None


def _normalize_baseline(raw: dict[str, Any]) -> dict[str, Any]:
    """Accept legacy flat rail maps and current nested schema."""
    grow_rail_ids = raw.get("grow_rail_ids")
    if isinstance(grow_rail_ids, list):
        ordered_ids = [str(rid) for rid in grow_rail_ids]
    else:
        ordered_ids = list_grow_rail_ids()

    if "rails" in raw and isinstance(raw["rails"], dict):
        all_rails = {str(k): int(v) for k, v in raw["rails"].items()}
    else:
        all_rails = {}
        for key, value in raw.items():
            if key.startswith("_") or key in {
                "ts", "verified_pool", "schema_version", "created_at_ms", "grow_rail_ids",
                "unique_verified",
            }:
                continue
            if isinstance(value, int):
                all_rails[str(key)] = value

    rails = {rid: all_rails.get(rid, 0) for rid in ordered_ids}
    verified_pool = sum(rails.values())
    out: dict[str, Any] = {
        "schema_version": int(raw.get("schema_version") or SCHEMA_VERSION),
        "created_at_ms": int(raw.get("created_at_ms") or raw.get("ts") or 0),
        "verified_pool": verified_pool,
        "grow_rail_ids": ordered_ids,
        "rails": rails,
    }
    if raw.get("unique_verified") is not None:
        out["unique_verified"] = int(raw["unique_verified"])
    return out


def load_baseline() -> dict[str, Any] | None:
    path = baseline_path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    return _normalize_baseline(raw)


def write_baseline(db: Path | None = None) -> dict[str, Any]:
    grow_ids = list_grow_rail_ids()
    counts = fetch_verified_pool_counts(db)
    unique_verified = fetch_unique_verified_library_count(db)
    rails = {rail_id: counts.rails.get(rail_id, 0) for rail_id in grow_ids}
    baseline = {
        "schema_version": SCHEMA_VERSION,
        "created_at_ms": _now_ms(),
        "grow_rail_ids": grow_ids,
        "verified_pool": sum(rails.values()),
        "unique_verified": unique_verified,
        "rails": rails,
    }
    path = baseline_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(baseline, indent=2) + "\n", encoding="utf-8")
    return baseline


@dataclass(frozen=True)
class PoolCounts:
    total: int
    rails: dict[str, int]


def fetch_verified_pool_counts(
    db_file: Path | None = None,
    *,
    now_ms: int | None = None,
) -> PoolCounts:
    """Count active verified titles per rail (excludes expired verify TTL)."""
    path = db_file or db_path()
    if not path.is_file():
        return PoolCounts(total=0, rails={})

    active_at = now_ms if now_ms is not None else _now_ms()
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            """
            SELECT rp.rail_id, COUNT(*) AS c
            FROM rail_pool rp
            JOIN titles t ON t.type = rp.type AND t.id = rp.id
            WHERE t.status = 'verified'
              AND (t.expires_at IS NULL OR t.expires_at > ?)
            GROUP BY rp.rail_id
            ORDER BY rp.rail_id
            """,
            (active_at,),
        ).fetchall()
    finally:
        conn.close()

    rails = {str(rail_id): int(count) for rail_id, count in rows}
    return PoolCounts(total=sum(rails.values()), rails=rails)


def fetch_unique_verified_library_count(
    db_file: Path | None = None,
    *,
    now_ms: int | None = None,
) -> int:
    """Distinct active verified titles in the global library (titles table)."""
    path = db_file or db_path()
    if not path.is_file():
        return 0

    active_at = now_ms if now_ms is not None else _now_ms()
    conn = sqlite3.connect(path)
    try:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM titles
            WHERE status = 'verified'
              AND (expires_at IS NULL OR expires_at > ?)
            """,
            (active_at,),
        ).fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


def fetch_distinct_probe_verified_since(
    since_ms: int,
    db_file: Path | None = None,
) -> int:
    """Distinct titles with a successful probe since since_ms (verify_log)."""
    path = db_file or db_path()
    if not path.is_file() or since_ms <= 0:
        return 0

    conn = sqlite3.connect(path)
    try:
        try:
            row = conn.execute(
                """
                SELECT COUNT(DISTINCT type || ':' || id_value) AS c
                FROM verify_log
                WHERE started_at > ? AND outcome = 'verified'
                """,
                (since_ms,),
            ).fetchone()
            return int(row[0]) if row else 0
        except sqlite3.OperationalError:
            return 0
    finally:
        conn.close()


def fetch_verify_log_stats(since_ms: int, db_file: Path | None = None) -> dict[str, dict[str, int]]:
    path = db_file or db_path()
    if not path.is_file():
        return {}

    conn = sqlite3.connect(path)
    try:
        try:
            rows = conn.execute(
                """
                SELECT rail_id, outcome, COUNT(*) AS c
                FROM verify_log
                WHERE started_at > ? AND rail_id IS NOT NULL
                GROUP BY rail_id, outcome
                ORDER BY rail_id, outcome
                """,
                (since_ms,),
            ).fetchall()
        except sqlite3.OperationalError:
            return {}
    finally:
        conn.close()

    stats: dict[str, dict[str, int]] = {}
    for rail_id, outcome, count in rows:
        bucket = stats.setdefault(str(rail_id), {})
        bucket[str(outcome)] = int(count)
    return stats


def _grow_target_for_rail(
    rail_id: str,
    verified_before: int,
    catalog: dict[str, RailPlayabilityConfig],
) -> int:
    cfg = catalog.get(rail_id, RailPlayabilityConfig())
    return resolve_grow_target(cfg, verified_before)


@dataclass(frozen=True)
class RailLiveStatus:
    rail_id: str
    verified_before: int
    verified_now: int
    pool_growth: int
    fresh_verified: int
    grow_target: int
    grow_target_met: bool
    sparse_tier: bool
    verify_stats: dict[str, int]


def build_live_status(
    baseline: dict[str, Any] | None,
    catalog: dict[str, RailPlayabilityConfig] | None = None,
    *,
    verify_window_ms: int = 60 * 60 * 1000,
    db_file: Path | None = None,
) -> dict[str, Any]:
    if catalog is None:
        catalog = load_catalog_playability()
    baseline = baseline or {"verified_pool": 0, "rails": {}, "grow_rail_ids": list_grow_rail_ids()}
    baseline_rails: dict[str, int] = baseline.get("rails") or {}
    grow_rail_ids: list[str] = list(baseline.get("grow_rail_ids") or list_grow_rail_ids())
    current = fetch_verified_pool_counts(db_file)
    since_ms = int(baseline.get("created_at_ms") or 0) or (_now_ms() - verify_window_ms)
    verify_stats = fetch_verify_log_stats(since_ms, db_file)
    unique_now = fetch_unique_verified_library_count(db_file)
    if "unique_verified" in baseline:
        unique_before = int(baseline["unique_verified"])
    elif since_ms > 0:
        # Legacy baselines without unique_verified — best-effort from verify_log.
        unique_before = max(0, unique_now - fetch_distinct_probe_verified_since(since_ms, db_file))
    else:
        unique_before = 0
    unique_delta = unique_now - unique_before
    distinct_probe_verified = fetch_distinct_probe_verified_since(since_ms, db_file)

    rows: list[RailLiveStatus] = []
    met_count = 0
    grow_pool_before = 0
    grow_pool_now = 0

    for rail_id in grow_rail_ids:
        verified_before = int(baseline_rails.get(rail_id, 0))
        verified_now = int(current.rails.get(rail_id, verified_before))
        pool_growth = verified_now - verified_before
        stats = verify_stats.get(rail_id, {})
        fresh_verified = int(stats.get("verified", 0))
        grow_target = _grow_target_for_rail(rail_id, verified_before, catalog)
        sparse_tier = verified_before < catalog.get(
            rail_id,
            RailPlayabilityConfig(),
        ).display_limit
        met = fresh_verified >= grow_target
        if met:
            met_count += 1
        grow_pool_before += verified_before
        grow_pool_now += verified_now
        rows.append(
            RailLiveStatus(
                rail_id=rail_id,
                verified_before=verified_before,
                verified_now=verified_now,
                pool_growth=pool_growth,
                fresh_verified=fresh_verified,
                grow_target=grow_target,
                grow_target_met=met,
                sparse_tier=sparse_tier,
                verify_stats=verify_stats.get(rail_id, {}),
            ),
        )

    grow_ids_set = set(grow_rail_ids)
    extra_rails = {
        rail_id: count
        for rail_id, count in sorted(current.rails.items())
        if rail_id not in grow_ids_set
    }

    browse_count = len(rows)
    pass_rate = met_count / browse_count if browse_count else 0.0
    return {
        "baseline_path": str(baseline_path()),
        "baseline_created_at_ms": baseline.get("created_at_ms"),
        "grow_rail_ids": grow_rail_ids,
        "verified_pool": grow_pool_now,
        "verified_pool_delta": grow_pool_now - grow_pool_before,
        "global_verified_pool": current.total,
        "unique_verified": unique_now,
        "unique_verified_before": unique_before,
        "unique_verified_delta": unique_delta,
        "distinct_probe_verified": distinct_probe_verified,
        "rails_met_target": met_count,
        "rails_total": browse_count,
        "program_pass_rate": pass_rate,
        "program_pass": pass_rate >= PROGRAM_PASS_RATE if browse_count else False,
        "grow": detect_grow_state(),
        "extra_rails": extra_rails,
        "rails": [
            {
                "rail_id": row.rail_id,
                "verified_before": row.verified_before,
                "verified_now": row.verified_now,
                "pool_growth": row.pool_growth,
                "fresh_verified": row.fresh_verified,
                "grow_target": row.grow_target,
                "grow_target_met": row.grow_target_met,
                "sparse_tier": row.sparse_tier,
                "verify_stats": row.verify_stats,
            }
            for row in rows
        ],
    }


def _format_phase_line(grow: dict[str, Any]) -> str | None:
    phase = grow.get("phase")
    if not phase or phase in {"done", "idle", "init"}:
        return None
    message = grow.get("phase_message") or ""
    state = grow.get("run_state") if isinstance(grow.get("run_state"), dict) else {}
    if phase == "preflight":
        done = state.get("preflight_done")
        total = state.get("preflight_total")
        if isinstance(done, int) and isinstance(total, int) and total > 0:
            message = f"{message} ({done}/{total})".strip()
    label = phase
    if message:
        return f"phase: {label} — {message}"
    return f"phase: {label}"


def format_live_status(data: dict[str, Any], *, verbose: bool = False) -> str:
    grow = data.get("grow") or {}
    global_pool = data.get("global_verified_pool")
    unique_now = int(data.get("unique_verified") or 0)
    unique_before = int(data.get("unique_verified_before") or 0)
    unique_delta = int(data.get("unique_verified_delta") or (unique_now - unique_before))
    pool_line = (
        f"unique: {unique_now} titles ({unique_delta:+d} since baseline)"
    )
    slots_line = (
        f"pool slots: {data.get('verified_pool', 0)} grow-rail "
        f"({data.get('verified_pool_delta', 0):+d})"
    )
    if global_pool is not None and global_pool != data.get("verified_pool"):
        slots_line += f" · global slots {global_pool}"

    lines = [
        "mango library grower",
        f"baseline: {data.get('baseline_path', '-')}",
        pool_line,
        slots_line,
        f"rails +target: {data.get('rails_met_target', 0)}/{data.get('rails_total', 0)} "
        f"({int(round((data.get('program_pass_rate') or 0) * 100))}%)",
        f"running: {'yes' if grow.get('running') else 'no'}"
        + (f" pid={grow.get('pid')}" if grow.get('pid') else ""),
    ]
    phase_line = _format_phase_line(grow)
    if phase_line:
        lines.append(phase_line)
    if grow.get("log"):
        lines.append(f"log: {grow['log']}")
    lines.append("")
    lines.append(
        f"{'rail':28} {'before':>6} {'now':>6} {'+pool':>6} {'tgt':>4} {'met':>4} "
        f"{'vfy':>4} {'ns':>4}",
    )
    lines.append("-" * 76)

    for row in data.get("rails") or []:
        if not isinstance(row, dict):
            continue
        stats = row.get("verify_stats") or {}
        verified = int(stats.get("verified", 0))
        no_stream = int(stats.get("no_stream", 0))
        growth = int(row.get("pool_growth") or 0)
        mark = " ✓" if row.get("grow_target_met") else ""
        lines.append(
            f"{str(row.get('rail_id', '-'))[:28]:28} "
            f"{int(row.get('verified_before') or 0):6d} "
            f"{int(row.get('verified_now') or 0):6d} "
            f"{growth:+6d} "
            f"{int(row.get('grow_target') or 0):4d} "
            f"{'yes' if row.get('grow_target_met') else 'no':>4} "
            f"{verified:4d} {no_stream:4d}{mark}",
        )

    extra = data.get("extra_rails") or {}
    if verbose and extra:
        lines.append("")
        lines.append("extra pool rails (not in grow pass):")
        for rail_id, count in extra.items():
            lines.append(f"  {rail_id}: {count}")

    return "\n".join(lines) + "\n"


def assess_refresh_json(path: Path, catalog: dict[str, RailPlayabilityConfig] | None = None) -> str:
    payload = json.loads(path.read_text(encoding="utf-8"))
    summary = summarize_grow_sla(
        [{"kind": "playability_growth", "payload": payload}],
        catalog=catalog,
    )
    if summary is None:
        return f"no grow rails in {path.name}\n"
    header = f"assess: {path.name}\n"
    unique_before = payload.get("unique_verified_before")
    unique_after = payload.get("unique_verified_after")
    unique_delta = payload.get("unique_verified_delta")
    if unique_before is not None and unique_after is not None:
        delta = (
            int(unique_delta)
            if unique_delta is not None
            else int(unique_after) - int(unique_before)
        )
        header += f"unique library: {unique_after} titles (+{delta} this run, was {unique_before})\n"
    return header + format_grow_sla_section(summary)


def cmd_baseline(_args: argparse.Namespace) -> int:
    baseline = write_baseline()
    print(json.dumps(baseline, indent=2))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    baseline = load_baseline()
    if baseline is None:
        if not getattr(args, "allow_missing_baseline", False):
            print(
                f"note: no baseline at {baseline_path()} — showing grow rails only",
                file=sys.stderr,
            )
        baseline = {
            "schema_version": SCHEMA_VERSION,
            "created_at_ms": _now_ms() - 60 * 60 * 1000,
            "verified_pool": 0,
            "grow_rail_ids": list_grow_rail_ids(),
            "rails": {},
        }
    data = build_live_status(baseline)
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print(format_live_status(data, verbose=args.verbose), end="")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    polls = 0
    while True:
        polls += 1
        print(f"=== poll {polls} {time.strftime('%H:%M:%S')} ===")
        rc = cmd_status(argparse.Namespace(json=False, allow_missing_baseline=True, verbose=False))
        grow = detect_grow_state()
        if not grow["running"]:
            print("grow: not running")
            if args.exit_when_done:
                return rc
            break
        else:
            print("grow: running")
            phase_line = _format_phase_line(grow)
            if phase_line:
                print(phase_line)
        if args.max_polls and polls >= args.max_polls:
            return rc
        time.sleep(max(5, args.interval))
    return rc


def cmd_assess(args: argparse.Namespace) -> int:
    baseline = load_baseline()
    after_ms = int(baseline.get("created_at_ms") or 0) if baseline else None
    if args.refresh_json:
        path = Path(args.refresh_json).expanduser()
    else:
        path = _latest_refresh_json(after_ms=after_ms if after_ms else None)
        if path is None:
            path = _latest_refresh_json()
    if path is None or not path.is_file():
        print("no refresh-playability JSON found in ops cache", file=sys.stderr)
        return 1
    text = assess_refresh_json(path)
    if args.json:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = collect_grow_rail_rows([{"kind": "playability_growth", "payload": payload}])
        summary = summarize_grow_sla(
            [{"kind": "playability_growth", "payload": payload}],
        )
        print(json.dumps({
            "path": str(path),
            "unique_verified_before": payload.get("unique_verified_before"),
            "unique_verified_after": payload.get("unique_verified_after"),
            "unique_verified_delta": payload.get("unique_verified_delta"),
            "summary": summary.__dict__ if summary else None,
            "rows": rows,
        }, indent=2, default=str))
    else:
        print(text, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Library Grower monitor")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("baseline", help="snapshot verified pool to grow-baseline.json")

    status = sub.add_parser("status", help="live pool deltas vs baseline")
    status.add_argument("--json", action="store_true")
    status.add_argument("--verbose", action="store_true", help="include non-grow pool rails")
    status.add_argument(
        "--allow-missing-baseline",
        action="store_true",
        help=argparse.SUPPRESS,
    )

    watch = sub.add_parser("watch", help="poll status until grow stops or max polls")
    watch.add_argument("--interval", type=int, default=30)
    watch.add_argument("--max-polls", type=int, default=0)
    watch.add_argument("--exit-when-done", action="store_true")

    assess = sub.add_parser("assess", help="SLA assess latest or given refresh JSON")
    assess.add_argument("--refresh-json")
    assess.add_argument("--json", action="store_true")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "baseline":
        return cmd_baseline(args)
    if args.command == "status":
        return cmd_status(args)
    if args.command == "watch":
        return cmd_watch(args)
    if args.command == "assess":
        return cmd_assess(args)
    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())

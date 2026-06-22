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
    load_catalog_playability,
    resolve_grow_target,
    summarize_grow_sla,
)

SCHEMA_VERSION = 1
DEFAULT_BASELINE = "grow-baseline.json"
GROW_INDEXER_PATTERN = "playability-indexer.ts refresh"


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


def detect_grow_state() -> dict[str, Any]:
    pidfile = pidfile_path()
    pid: int | None = None
    if pidfile.is_file():
        try:
            pid = int(pidfile.read_text(encoding="utf-8").strip())
        except ValueError:
            pid = None

    pid_alive = pid is not None and _pid_alive(pid)
    lock_held = maintenance_lock_path().is_file()
    indexer_lines = _pgrep(GROW_INDEXER_PATTERN)
    maintenance_lines = [
        line for line in _pgrep("playability-maintenance.sh")
        if "playability-maintenance.sh --mode" in line or "playability-maintenance.sh --mode" in line
    ]

    running = pid_alive or bool(indexer_lines) or bool(maintenance_lines)
    return {
        "running": running,
        "pid": pid if pid_alive else None,
        "pidfile": str(pidfile),
        "maintenance_lock": lock_held,
        "indexer": indexer_lines[:3],
        "maintenance": maintenance_lines[:2],
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


def _latest_refresh_json() -> Path | None:
    files = sorted(
        ops_dir().glob("refresh-playability-*.json"),
        key=lambda path: path.stat().st_mtime,
    )
    return files[-1] if files else None


def _normalize_baseline(raw: dict[str, Any]) -> dict[str, Any]:
    """Accept legacy flat rail maps and current nested schema."""
    if "rails" in raw and isinstance(raw["rails"], dict):
        rails = {str(k): int(v) for k, v in raw["rails"].items()}
        verified_pool = int(raw.get("verified_pool") or sum(rails.values()))
        return {
            "schema_version": int(raw.get("schema_version") or SCHEMA_VERSION),
            "created_at_ms": int(raw.get("created_at_ms") or raw.get("ts") or 0),
            "verified_pool": verified_pool,
            "rails": rails,
        }

    rails: dict[str, int] = {}
    for key, value in raw.items():
        if key.startswith("_") or key in {"ts", "verified_pool", "schema_version", "created_at_ms"}:
            continue
        if isinstance(value, int):
            rails[str(key)] = value
    return {
        "schema_version": SCHEMA_VERSION,
        "created_at_ms": int(raw.get("ts") or raw.get("created_at_ms") or 0),
        "verified_pool": int(raw.get("verified_pool") or sum(rails.values())),
        "rails": rails,
    }


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
    counts = fetch_verified_pool_counts(db)
    baseline = {
        "schema_version": SCHEMA_VERSION,
        "created_at_ms": _now_ms(),
        "verified_pool": counts.total,
        "rails": counts.rails,
    }
    path = baseline_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(baseline, indent=2) + "\n", encoding="utf-8")
    return baseline


@dataclass(frozen=True)
class PoolCounts:
    total: int
    rails: dict[str, int]


def fetch_verified_pool_counts(db_file: Path | None = None) -> PoolCounts:
    path = db_file or db_path()
    if not path.is_file():
        return PoolCounts(total=0, rails={})

    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            """
            SELECT rp.rail_id, COUNT(*) AS c
            FROM rail_pool rp
            JOIN titles t ON t.type = rp.type AND t.id = rp.id
            WHERE t.status = 'verified'
            GROUP BY rp.rail_id
            ORDER BY rp.rail_id
            """,
        ).fetchall()
    finally:
        conn.close()

    rails = {str(rail_id): int(count) for rail_id, count in rows}
    return PoolCounts(total=sum(rails.values()), rails=rails)


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
    baseline = baseline or {"verified_pool": 0, "rails": {}}
    baseline_rails: dict[str, int] = baseline.get("rails") or {}
    current = fetch_verified_pool_counts(db_file)
    since_ms = int(baseline.get("created_at_ms") or 0) or (_now_ms() - verify_window_ms)
    verify_stats = fetch_verify_log_stats(since_ms, db_file)

    rail_ids = sorted(set(baseline_rails) | set(current.rails) | set(catalog))
    rows: list[RailLiveStatus] = []
    met_count = 0

    for rail_id in rail_ids:
        verified_before = int(baseline_rails.get(rail_id, 0))
        verified_now = int(current.rails.get(rail_id, verified_before))
        pool_growth = verified_now - verified_before
        grow_target = _grow_target_for_rail(rail_id, verified_before, catalog)
        sparse_tier = verified_before < catalog.get(
            rail_id,
            RailPlayabilityConfig(),
        ).display_limit
        met = pool_growth >= grow_target
        if met:
            met_count += 1
        rows.append(
            RailLiveStatus(
                rail_id=rail_id,
                verified_before=verified_before,
                verified_now=verified_now,
                pool_growth=pool_growth,
                grow_target=grow_target,
                grow_target_met=met,
                sparse_tier=sparse_tier,
                verify_stats=verify_stats.get(rail_id, {}),
            ),
        )

    browse_count = len(rows)
    pass_rate = met_count / browse_count if browse_count else 0.0
    return {
        "baseline_path": str(baseline_path()),
        "baseline_created_at_ms": baseline.get("created_at_ms"),
        "verified_pool": current.total,
        "verified_pool_delta": current.total - int(baseline.get("verified_pool") or 0),
        "rails_met_target": met_count,
        "rails_total": browse_count,
        "program_pass_rate": pass_rate,
        "program_pass": pass_rate >= PROGRAM_PASS_RATE if browse_count else False,
        "grow": detect_grow_state(),
        "rails": [
            {
                "rail_id": row.rail_id,
                "verified_before": row.verified_before,
                "verified_now": row.verified_now,
                "pool_growth": row.pool_growth,
                "grow_target": row.grow_target,
                "grow_target_met": row.grow_target_met,
                "sparse_tier": row.sparse_tier,
                "verify_stats": row.verify_stats,
            }
            for row in rows
        ],
    }


def format_live_status(data: dict[str, Any]) -> str:
    grow = data.get("grow") or {}
    lines = [
        "mango library grower",
        f"baseline: {data.get('baseline_path', '-')}",
        f"pool: {data.get('verified_pool', 0)} "
        f"(delta {data.get('verified_pool_delta', 0):+d})",
        f"rails +target: {data.get('rails_met_target', 0)}/{data.get('rails_total', 0)} "
        f"({int(round((data.get('program_pass_rate') or 0) * 100))}%)",
        f"running: {'yes' if grow.get('running') else 'no'}"
        + (f" pid={grow.get('pid')}" if grow.get('pid') else ""),
    ]
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
        if growth == 0 and verified == 0 and no_stream == 0 and not row.get("grow_target_met"):
            continue
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

    return "\n".join(lines) + "\n"


def assess_refresh_json(path: Path, catalog: dict[str, RailPlayabilityConfig] | None = None) -> str:
    payload = json.loads(path.read_text(encoding="utf-8"))
    summary = summarize_grow_sla(
        [{"kind": "playability_growth", "payload": payload}],
        catalog=catalog,
    )
    if summary is None:
        return f"no grow rails in {path}\n"
    header = f"assess: {path.name}\n"
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
                f"note: no baseline at {baseline_path()} — showing pool only",
                file=sys.stderr,
            )
        baseline = {
            "schema_version": SCHEMA_VERSION,
            "created_at_ms": _now_ms() - 60 * 60 * 1000,
            "verified_pool": 0,
            "rails": {},
        }
    data = build_live_status(baseline)
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print(format_live_status(data), end="")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    polls = 0
    while True:
        polls += 1
        print(f"=== poll {polls} {time.strftime('%H:%M:%S')} ===")
        rc = cmd_status(argparse.Namespace(json=False, allow_missing_baseline=True))
        grow = detect_grow_state()
        if not grow["running"]:
            print("grow: not running")
            if args.exit_when_done:
                return rc
            break
        else:
            print("grow: running")
        if args.max_polls and polls >= args.max_polls:
            return rc
        time.sleep(max(5, args.interval))
    return rc


def cmd_assess(args: argparse.Namespace) -> int:
    path = Path(args.refresh_json).expanduser() if args.refresh_json else _latest_refresh_json()
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
        print(json.dumps({"path": str(path), "summary": summary.__dict__ if summary else None, "rows": rows}, indent=2, default=str))
    else:
        print(text, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Library Grower monitor")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("baseline", help="snapshot verified pool to grow-baseline.json")

    status = sub.add_parser("status", help="live pool deltas vs baseline")
    status.add_argument("--json", action="store_true")
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

#!/usr/bin/env python3
"""Poll playability maintenance progress (works while catalog-service is down)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import sqlite3

DB = os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db")
LOG = os.environ.get("MANGO_MAINTENANCE_LOG", "/tmp/mango-maintenance-full.log")
INTERVAL = int(os.environ.get("MANGO_POLL_INTERVAL_SEC", "30"))
MAX_POLLS = int(os.environ.get("MANGO_POLL_MAX", "1"))


def maintenance_running() -> bool:
    for pat in ("playability-maintenance.sh", "playability-indexer.ts refresh"):
        if subprocess.run(["pgrep", "-f", pat], capture_output=True).returncode == 0:
            return True
    return False


def proc_count(pattern: str) -> int:
    result = subprocess.run(
        ["bash", "-lc", f"pgrep -cf '{pattern}' || true"],
        capture_output=True,
        text=True,
    )
    try:
        return int(result.stdout.strip() or 0)
    except ValueError:
        return 0


def db_metrics() -> dict[str, int]:
    now = int(time.time() * 1000)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    verified_total = conn.execute(
        "SELECT COUNT(*) FROM titles WHERE status='verified'"
    ).fetchone()[0]
    failed_total = conn.execute(
        "SELECT COUNT(*) FROM titles WHERE status='failed'"
    ).fetchone()[0]
    pool_total = conn.execute("SELECT COUNT(*) FROM rail_pool").fetchone()[0]
    rows = conn.execute(
        """
        SELECT rp.rail_id,
          COUNT(*) AS pool,
          SUM(CASE WHEN t.status='verified' AND COALESCE(t.expires_at, 0) > ?
              THEN 1 ELSE 0 END) AS verified
        FROM rail_pool rp
        LEFT JOIN titles t ON t.type = rp.type AND t.id = rp.id
        WHERE rp.rail_id LIKE 'movies-%' OR rp.rail_id LIKE 'series-%'
        GROUP BY rp.rail_id
        """,
        (now,),
    ).fetchall()
    return {
        "verified_total": verified_total,
        "failed_total": failed_total,
        "pool_total": pool_total,
        "new_rails": len(rows),
        "new_rails_filled": sum(1 for row in rows if (row["verified"] or 0) > 0),
        "new_verified": sum(row["verified"] or 0 for row in rows),
        "new_pool": sum(row["pool"] or 0 for row in rows),
    }


def log_metrics() -> dict:
    if not os.path.exists(LOG):
        return {"phase": "no log", "bytes": 0}
    data = open(LOG, encoding="utf-8").read()
    if '"duration_ms"' in data:
        try:
            start = data.index("{")
            end = data.rindex("}") + 1
            payload = json.loads(data[start:end])
            return {
                "phase": "done",
                "bytes": len(data),
                "duration_ms": payload.get("duration_ms"),
                "verified": payload.get("verified"),
                "failed": payload.get("failed"),
                "verify_queue_size": payload.get("verify_queue_size"),
            }
        except (json.JSONDecodeError, ValueError):
            pass
    return {"phase": "indexing", "bytes": len(data)}


def main() -> int:
    print(f"poll_interval_sec={INTERVAL} max_polls={MAX_POLLS}")
    print(
        "poll  utc      state idx mpv  verified(+Δ) failed(+Δ) "
        "new_filled new_v pool  log"
    )
    prev: dict[str, int] | None = None
    for poll in range(1, MAX_POLLS + 1):
        ts = time.strftime("%H:%M:%S", time.gmtime())
        running = maintenance_running()
        db = db_metrics()
        logm = log_metrics()
        delta_v = delta_f = "-"
        if prev is not None:
            delta_v = db["verified_total"] - prev["verified_total"]
            delta_f = db["failed_total"] - prev["failed_total"]
        print(
            f"{poll:02d}    {ts}  "
            f"{'RUN' if running else 'IDLE':4} "
            f"{proc_count('playability-indexer.ts'):3d} "
            f"{proc_count('mpv-probe-ipc.sh'):3d}  "
            f"{db['verified_total']:4d}(+{delta_v:>3}) "
            f"{db['failed_total']:4d}(+{delta_f:>3})  "
            f"{db['new_rails_filled']:2d}/{db['new_rails']:<2d} "
            f"{db['new_verified']:4d} "
            f"{db['pool_total']:4d}  "
            f"{logm['phase']}"
        )
        if not running and logm.get("phase") == "done":
            print("--- done ---")
            print(
                f"duration_ms={logm.get('duration_ms')} "
                f"verified={logm.get('verified')} "
                f"failed={logm.get('failed')} "
                f"queue={logm.get('verify_queue_size')}"
            )
            return 0
        prev = db
        if poll < MAX_POLLS:
            time.sleep(INTERVAL)
    return 0


if __name__ == "__main__":
    sys.exit(main())

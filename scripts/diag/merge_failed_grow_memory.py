#!/usr/bin/env python3
"""Merge negative candidate memory from a failed staged grow into the live DB."""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path
from typing import Iterable


TITLE_COLUMNS = [
    "type",
    "id",
    "status",
    "verified_at",
    "expires_at",
    "fail_reason",
    "best_source",
    "cache_status",
    "debrid_service",
    "probe_ms",
    "win_url_hash",
    "win_ladder_step",
    "updated_at",
]

REJECTION_COLUMNS = [
    "rail_id",
    "type",
    "id",
    "reason",
    "source_key",
    "run_id",
    "created_at",
    "expires_at",
    "details",
]

VERIFY_LOG_COLUMNS = [
    "started_at",
    "rail_id",
    "type",
    "id_value",
    "stage",
    "ms",
    "outcome",
]


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def common_columns(conn: sqlite3.Connection, table: str, desired: Iterable[str]) -> list[str]:
    available = table_columns(conn, table)
    return [column for column in desired if column in available]


def merge_failed_titles(
    conn: sqlite3.Connection,
    since_ms: int,
) -> int:
    columns = common_columns(conn, "titles", TITLE_COLUMNS)
    if not {"type", "id", "status", "updated_at"}.issubset(columns):
        return 0
    select_columns = ", ".join(f"work.titles.{column}" for column in columns)
    insert_columns = ", ".join(columns)
    update_columns = ", ".join(
        f"{column}=excluded.{column}"
        for column in columns
        if column not in {"type", "id"}
    )
    before = conn.total_changes
    conn.execute(
        f"""
INSERT INTO main.titles ({insert_columns})
SELECT {select_columns}
FROM work.titles
WHERE work.titles.status = 'failed'
  AND work.titles.updated_at >= ?
ON CONFLICT(type, id) DO UPDATE SET
  {update_columns}
WHERE excluded.updated_at >= main.titles.updated_at;
""",
        (since_ms,),
    )
    return conn.total_changes - before


def merge_candidate_rejections(
    conn: sqlite3.Connection,
    since_ms: int,
    now_ms: int,
) -> int:
    if not table_exists(conn, "rail_candidate_rejections"):
        return 0
    columns = common_columns(conn, "rail_candidate_rejections", REJECTION_COLUMNS)
    if not {"rail_id", "type", "id", "reason", "created_at", "expires_at"}.issubset(columns):
        return 0
    select_columns = ", ".join(f"work.rail_candidate_rejections.{column}" for column in columns)
    insert_columns = ", ".join(columns)
    update_columns = ", ".join(
        f"{column}=excluded.{column}"
        for column in columns
        if column not in {"rail_id", "type", "id"}
    )
    before = conn.total_changes
    conn.execute(
        f"""
INSERT INTO main.rail_candidate_rejections ({insert_columns})
SELECT {select_columns}
FROM work.rail_candidate_rejections
WHERE work.rail_candidate_rejections.created_at >= ?
  AND work.rail_candidate_rejections.expires_at > ?
ON CONFLICT(rail_id, type, id) DO UPDATE SET
  {update_columns}
WHERE excluded.expires_at >= main.rail_candidate_rejections.expires_at;
""",
        (since_ms, now_ms),
    )
    return conn.total_changes - before


def merge_failed_verify_logs(
    conn: sqlite3.Connection,
    since_ms: int,
) -> int:
    if not table_exists(conn, "verify_log"):
        return 0
    columns = common_columns(conn, "verify_log", VERIFY_LOG_COLUMNS)
    if not {"started_at", "type", "id_value", "outcome"}.issubset(columns):
        return 0
    select_columns = ", ".join(f"work.verify_log.{column}" for column in columns)
    insert_columns = ", ".join(columns)
    before = conn.total_changes
    conn.execute(
        f"""
INSERT INTO main.verify_log ({insert_columns})
SELECT {select_columns}
FROM work.verify_log
JOIN work.titles
  ON work.titles.type = work.verify_log.type
 AND work.titles.id = work.verify_log.id_value
WHERE work.verify_log.started_at >= ?
  AND work.titles.status = 'failed';
""",
        (since_ms,),
    )
    return conn.total_changes - before


def merge_failed_grow_memory(
    live_db: Path,
    work_db: Path,
    since_ms: int,
    now_ms: int,
) -> dict[str, int]:
    conn = sqlite3.connect(live_db)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("ATTACH DATABASE ? AS work", (str(work_db),))
        with conn:
            failed_titles = merge_failed_titles(conn, since_ms)
            candidate_rejections = merge_candidate_rejections(conn, since_ms, now_ms)
            verify_logs = merge_failed_verify_logs(conn, since_ms)
        conn.execute("DETACH DATABASE work")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return {
            "failed_titles": failed_titles,
            "candidate_rejections": candidate_rejections,
            "verify_logs": verify_logs,
        }
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-db", required=True)
    parser.add_argument("--work-db", required=True)
    parser.add_argument("--since-ms", type=int, required=True)
    parser.add_argument("--now-ms", type=int, required=True)
    args = parser.parse_args()

    counts = merge_failed_grow_memory(
        live_db=Path(args.live_db),
        work_db=Path(args.work_db),
        since_ms=args.since_ms,
        now_ms=args.now_ms,
    )
    print(
        "failed_titles={failed_titles} candidate_rejections={candidate_rejections} "
        "verify_logs={verify_logs}".format(**counts)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

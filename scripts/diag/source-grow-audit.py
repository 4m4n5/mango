#!/usr/bin/env python3
"""Audit Library Grower source health from runtime state and playability.db."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    print("source-grow-audit: PyYAML required", file=sys.stderr)
    raise SystemExit(2)


REPO = Path(os.environ.get("MANGO_REPO_DIR", Path.cwd()))


def cache_dir() -> Path:
    return Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "mango"


def source_grow_path() -> Path:
    return Path(
        os.environ.get(
            "MANGO_SOURCE_GROW_OUT",
            cache_dir() / "source-grow" / "latest.json",
        ),
    ).expanduser()


def source_hitrate_path() -> Path:
    return Path(
        os.environ.get(
            "MANGO_SOURCE_HITRATE_OUT",
            cache_dir() / "source-hitrate" / "latest.json",
        ),
    ).expanduser()


def db_path() -> Path:
    return Path(os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db"))


def catalog_yaml_path() -> Path:
    return Path(
        os.environ.get("MANGO_CATALOG_YAML", REPO / "config" / "catalog.example.yaml"),
    )


def source_key(addon: str, catalog: str) -> str:
    return f"{addon}:{catalog}"


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def load_catalog_sources(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    if not path.is_file():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for rail in data.get("rails") or []:
        if rail.get("enabled") is False:
            continue
        rail_id = str(rail.get("id") or "")
        content_type = str(rail.get("content_type") or "movie")
        if not rail_id or rail_id == "continue":
            continue
        refs: list[dict[str, Any]] = []
        if rail.get("type") == "addon_catalog":
            refs.append({"addon": rail.get("addon"), "catalog": rail.get("catalog"), "weight": 1})
        elif rail.get("type") == "composite_list":
            refs.extend(rail.get("sources") or [])
        for ref in refs:
            addon = str(ref.get("addon") or "")
            catalog = str(ref.get("catalog") or "")
            if not addon or not catalog:
                continue
            out[(rail_id, source_key(addon, catalog))] = {
                "rail_id": rail_id,
                "source_key": source_key(addon, catalog),
                "addon": addon,
                "catalog": catalog,
                "content_type": content_type,
                "yaml_weight": float(ref.get("weight") or 1),
            }
    return out


def load_db_metrics(path: Path) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "cursors": {},
        "rejections": defaultdict(lambda: defaultdict(int)),
    }
    if not path.is_file():
        return metrics
    try:
        conn = sqlite3.connect(path)
    except sqlite3.Error:
        return metrics
    try:
        if _table_exists(conn, "rail_source_ingest_state"):
            for rail_id, source, offset in conn.execute(
                "SELECT rail_id, source_key, catalog_offset FROM rail_source_ingest_state",
            ):
                metrics["cursors"][(str(rail_id), str(source))] = int(offset or 0)
        if _table_exists(conn, "rail_candidate_rejections"):
            now_ms = int(__import__("time").time() * 1000)
            for rail_id, source, reason, count in conn.execute(
                """
                SELECT rail_id, COALESCE(source_key, ''), reason, COUNT(*)
                FROM rail_candidate_rejections
                WHERE expires_at > ?
                GROUP BY rail_id, COALESCE(source_key, ''), reason
                """,
                (now_ms,),
            ):
                metrics["rejections"][(str(rail_id), str(source))][str(reason)] += int(count or 0)
    finally:
        conn.close()
    return metrics


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    ).fetchone()
    return row is not None


def hitrate_by_source(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in report.get("sources") or []:
        addon = str(row.get("addon") or "")
        catalog = str(row.get("catalog") or "")
        if addon and catalog:
            out[source_key(addon, catalog)] = row
    return out


def grow_entries_by_rail(report: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    out: dict[tuple[str, str], dict[str, Any]] = {}
    rail_sources = report.get("rail_sources") or {}
    if isinstance(rail_sources, dict):
        for rail_id, entries in rail_sources.items():
            for row in entries or []:
                key = str(row.get("source_key") or "")
                if key:
                    out[(str(rail_id), key)] = row
    return out


def rate(num: float, denom: float) -> float:
    return num / denom if denom > 0 else 0.0


def build_rows(
    catalog_sources: dict[tuple[str, str], dict[str, Any]],
    grow_report: dict[str, Any],
    hitrate_report: dict[str, Any],
    db_metrics: dict[str, Any],
) -> list[dict[str, Any]]:
    grow_rows = grow_entries_by_rail(grow_report)
    hitrate_rows = hitrate_by_source(hitrate_report)
    rows: list[dict[str, Any]] = []
    all_keys = set(catalog_sources) | set(grow_rows)
    for rail_id, key in sorted(all_keys):
        config = catalog_sources.get((rail_id, key), {})
        grow = grow_rows.get((rail_id, key), {})
        rejects = db_metrics["rejections"].get((rail_id, key), {})
        elapsed_min = max(0, float(grow.get("elapsed_ms") or 0) / 60_000)
        verified = int(grow.get("verified") or 0)
        failed = int(grow.get("failed") or 0)
        theme_rejected = int(grow.get("theme_rejected") or 0)
        unresolved_external_id = int(grow.get("unresolved_external_id") or 0)
        fresh_queued = int(grow.get("fresh_queued") or 0)
        skipped_verified = int(grow.get("skipped_verified") or 0)
        linked_seen = int(grow.get("linked_verified_seen") or 0)
        no_stream = int(rejects.get("no_stream") or 0)
        title_mismatch = int(rejects.get("title_mismatch") or 0)
        samples = verified + failed + theme_rejected + unresolved_external_id
        duplicate_seen = skipped_verified + linked_seen
        returned = int(grow.get("returned") or 0)
        probation_multiplier = float(grow.get("probation_multiplier") or 0.08)
        multiplier = float(grow.get("multiplier") or 1)
        probation = bool(grow.get("probation")) or multiplier <= probation_multiplier + 0.0001
        rows.append({
            "rail_id": rail_id,
            "source_key": key,
            "addon": config.get("addon") or key.split(":", 1)[0],
            "catalog": config.get("catalog") or key.split(":", 1)[-1],
            "content_type": config.get("content_type") or grow.get("content_type"),
            "yaml_weight": config.get("yaml_weight"),
            "runtime_multiplier": multiplier,
            "probation": probation,
            "probation_recovery": (not probation) and int(grow.get("runs") or 0) > 1 and multiplier > probation_multiplier * 1.5,
            "verified": verified,
            "verified_per_min": rate(verified, elapsed_min),
            "fresh_queued": fresh_queued,
            "failed": failed,
            "theme_rejected": theme_rejected,
            "theme_reject_rate": rate(theme_rejected, samples),
            "unresolved_external_id": unresolved_external_id,
            "unresolved_external_id_rate": rate(unresolved_external_id, samples),
            "no_stream": no_stream,
            "title_mismatch": title_mismatch,
            "no_stream_rate": rate(no_stream + title_mismatch, max(1, no_stream + title_mismatch + verified)),
            "duplicate_seen": duplicate_seen,
            "duplicate_rate": rate(duplicate_seen, max(1, returned + duplicate_seen)),
            "cursor_depth": db_metrics["cursors"].get((rail_id, key), 0),
            "stream_rate": hitrate_rows.get(key, {}).get("stream_rate"),
            "runs": int(grow.get("runs") or 0),
            "last_ts": grow.get("last_ts"),
            "rollback_reason": grow.get("rollback_reason"),
        })
    return rows


def print_table(rows: list[dict[str, Any]], limit: int) -> None:
    print("rail                         source                          mult prob v/min theme unresolved no_str dup  cursor")
    print("-" * 112)
    for row in rows[:limit]:
        prob = "Y" if row["probation"] else ("R" if row["probation_recovery"] else "-")
        print(
            f"{row['rail_id'][:28]:28} "
            f"{row['source_key'][:31]:31} "
            f"{row['runtime_multiplier']:4.2f} {prob:>4} "
            f"{row['verified_per_min']:5.2f} "
            f"{row['theme_reject_rate'] * 100:5.0f}% "
            f"{row['unresolved_external_id_rate'] * 100:9.0f}% "
            f"{row['no_stream_rate'] * 100:6.0f}% "
            f"{row['duplicate_rate'] * 100:4.0f}% "
            f"{row['cursor_depth']:7d}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rail", help="only show one rail")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    parser.add_argument("--limit", type=int, default=80)
    args = parser.parse_args(argv)

    catalog_sources = load_catalog_sources(catalog_yaml_path())
    db_metrics = load_db_metrics(db_path())
    rows = build_rows(
        catalog_sources,
        load_json(source_grow_path()),
        load_json(source_hitrate_path()),
        db_metrics,
    )
    if args.rail:
        rows = [row for row in rows if row["rail_id"] == args.rail]
    rows.sort(key=lambda row: (
        row["rail_id"],
        row["probation"] is False,
        -(row["theme_reject_rate"] + row["unresolved_external_id_rate"] + row["no_stream_rate"]),
        row["source_key"],
    ))

    payload = {
        "ok": True,
        "source_grow": str(source_grow_path()),
        "source_hitrate": str(source_hitrate_path()),
        "db": str(db_path()),
        "catalog_yaml": str(catalog_yaml_path()),
        "rows": rows,
    }
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print_table(rows, args.limit)
        print(f"\nrows={len(rows)} source_grow={source_grow_path()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

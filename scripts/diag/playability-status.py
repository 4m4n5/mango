#!/usr/bin/env python3
"""Print a couch-safe playability pool summary from catalog-service."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request


URL = "http://127.0.0.1:3020/playability/status"


def fetch_status() -> dict:
    try:
        with urllib.request.urlopen(URL, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise SystemExit(f"playability status unavailable: {exc}") from exc


def age(value: int | None) -> str:
    if not value:
        return "-"
    seconds = max(0, int(time.time() - value / 1000))
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    if hours < 48:
        return f"{hours}h"
    return f"{hours // 24}d"


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--json":
        data = fetch_status()
        print(json.dumps(data, indent=2))
        return 0
    return _main_table()


def _main_table() -> int:
    data = fetch_status()
    print("mango playability")
    print(f"db: {data.get('db_path', '-')}")
    print(f"last indexer: {age(data.get('last_indexer_run_at'))}")
    print()
    print(f"{'rail':24} {'fresh':>8} {'visible':>8} {'pool':>6} {'pending':>8} {'stale':>6} {'failed':>6} {'last ok':>8}")
    print("-" * 86)
    for rail in data.get("rails", []):
        verified_pool = int(rail.get("verified_pool") or 0)
        visible_pool = int(rail.get("visible_pool") if rail.get("visible_pool") is not None else verified_pool)
        print(
            f"{rail.get('rail_id', '-')[:24]:24} "
            f"{verified_pool:8d} "
            f"{visible_pool:8d} "
            f"{int(rail.get('pool_depth') or 0):6d} "
            f"{int(rail.get('pending') or 0):8d} "
            f"{int(rail.get('stale') or 0):6d} "
            f"{int(rail.get('failed') or 0):6d} "
            f"{age(rail.get('last_verified_at')):>8}"
        )
    totals = data.get("totals") or {}
    total_verified = int(totals.get("verified_pool") or 0)
    total_visible = int(totals.get("visible_pool") if totals.get("visible_pool") is not None else total_verified)
    print("-" * 86)
    print(
        f"{'total':24} "
        f"{total_verified:8d} "
        f"{total_visible:8d} "
        f"{int(totals.get('pool_depth') or 0):6d} "
        f"{int(totals.get('pending') or 0):8d} "
        f"{int(totals.get('stale') or 0):6d} "
        f"{int(totals.get('failed') or 0):6d}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

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
    data = fetch_status()
    print("mango playability")
    print(f"db: {data.get('db_path', '-')}")
    print(f"last indexer: {age(data.get('last_indexer_run_at'))}")
    print()
    print(f"{'rail':24} {'verified':>8} {'pool':>6} {'pending':>8} {'stale':>6} {'failed':>6} {'last ok':>8}")
    print("-" * 76)
    for rail in data.get("rails", []):
        print(
            f"{rail.get('rail_id', '-')[:24]:24} "
            f"{int(rail.get('verified_pool') or 0):8d} "
            f"{int(rail.get('pool_depth') or 0):6d} "
            f"{int(rail.get('pending') or 0):8d} "
            f"{int(rail.get('stale') or 0):6d} "
            f"{int(rail.get('failed') or 0):6d} "
            f"{age(rail.get('last_verified_at')):>8}"
        )
    totals = data.get("totals") or {}
    print("-" * 76)
    print(
        f"{'total':24} "
        f"{int(totals.get('verified_pool') or 0):8d} "
        f"{int(totals.get('pool_depth') or 0):6d} "
        f"{int(totals.get('pending') or 0):8d} "
        f"{int(totals.get('stale') or 0):6d} "
        f"{int(totals.get('failed') or 0):6d}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

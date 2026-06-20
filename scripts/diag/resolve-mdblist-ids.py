#!/usr/bin/env python3
"""Resolve mdblist.com list slugs to numeric catalog ids (mdblist.N).

Thin wrapper around scripts/diag/lib/mdblist_sync.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.mdblist_sync import resolve_slug  # noqa: E402


def main() -> None:
    slugs = sys.argv[1:]
    if not slugs:
        print("usage: resolve-mdblist-ids.py user/list-slug […]", file=sys.stderr)
        raise SystemExit(2)
    rows = []
    for slug in slugs:
        entry = resolve_slug(slug)
        if not entry:
            print(f"FAIL {slug}", file=sys.stderr)
            raise SystemExit(1)
        rows.append({
            "slug": entry.slug,
            "url": entry.url,
            "mdblist_id": entry.numeric_id,
            "catalog_id": entry.catalog_id,
            "items": entry.items,
            "title": entry.name,
        })
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Manage config/mdblist-inventory.json — sync toplists, merge slugs, export LLM context.

Usage:
  python3 scripts/diag/mdblist-inventory.py sync-toplists [--curated]
  python3 scripts/diag/mdblist-inventory.py resolve SLUG [SLUG...]
  python3 scripts/diag/mdblist-inventory.py list [--tag TAG] [--media movie|series]
  python3 scripts/diag/mdblist-inventory.py export-llm [--tag TAG] [--limit N]
  python3 scripts/diag/mdblist-inventory.py absorb-hitrate [--report PATH]
  python3 scripts/diag/mdblist-inventory.py absorb-pools [--status-url URL]
  python3 scripts/diag/mdblist-inventory.py measure
  python3 scripts/diag/mdblist-inventory.py show CATALOG_ID

Env:
  MANGO_MDBLIST_INVENTORY  path (default config/mdblist-inventory.json)
  MANGO_SOURCE_HITRATE_OUT report path (default ~/.cache/mango/source-hitrate/latest.json)
  MANGO_CATALOG_URL        for absorb-pools (default http://127.0.0.1:3020)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.mdblist_sync import (  # noqa: E402
    DEFAULT_INVENTORY,
    absorb_hitrate_report,
    absorb_pool_status,
    export_llm_context,
    fetch_toplists,
    load_inventory,
    merge_catalogs,
    record_snapshot,
    resolve_slug,
    save_inventory,
)

DEFAULT_HITRATE_REPORT = Path(
    os.environ.get(
        "MANGO_SOURCE_HITRATE_OUT",
        os.path.expanduser("~/.cache/mango/source-hitrate/latest.json"),
    ),
)
DEFAULT_CATALOG_URL = os.environ.get("MANGO_CATALOG_URL", "http://127.0.0.1:3020")


def inventory_path() -> Path:
    return Path(os.environ.get("MANGO_MDBLIST_INVENTORY", DEFAULT_INVENTORY))


def cmd_sync_toplists(args: argparse.Namespace) -> int:
    entries = fetch_toplists(curated=args.curated)
    source = "curatedlists" if args.curated else "toplists"
    inventory = load_inventory(inventory_path())
    added, updated = merge_catalogs(inventory, entries)
    record_snapshot(inventory, entries, source=source)
    path = save_inventory(inventory, inventory_path())
    print(f"synced {len(entries)} lists from {source} → {path}")
    print(f"  added {added}, updated {updated}, total {len(inventory['catalogs'])}")
    return 0


def cmd_resolve(args: argparse.Namespace) -> int:
    inventory = load_inventory(inventory_path())
    entries = []
    for slug in args.slugs:
        entry = resolve_slug(slug)
        if not entry:
            print(f"FAIL {slug}", file=sys.stderr)
            return 1
        entries.append(entry)
        print(f"OK {slug} → {entry.catalog_id} ({entry.items} items)")
    added, updated = merge_catalogs(inventory, entries)
    save_inventory(inventory, inventory_path())
    print(f"inventory: added {added}, updated {updated}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    inventory = load_inventory(inventory_path())
    rows = inventory.get("catalogs") or []
    if args.tag:
        rows = [row for row in rows if args.tag in (row.get("tags") or [])]
    if args.media:
        rows = [row for row in rows if row.get("media") == args.media]
    rows = sorted(rows, key=lambda row: -(row.get("popularity") or 0))
    for row in rows[: args.limit]:
        hit = row.get("hit_rate") or {}
        rate = hit.get("source")
        rate_s = f"{rate * 100:.0f}%" if isinstance(rate, (int, float)) else hit.get("status", "—")
        pop = row.get("popularity")
        pop_s = str(pop) if pop is not None else "—"
        print(
            f"{row.get('catalog_id'):18} {pop_s:>6}  {rate_s:>8}  "
            f"{(row.get('name') or '')[:42]:42}  [{','.join((row.get('tags') or [])[:4])}]"
        )
    print(f"({len(rows)} matching)")
    return 0


def cmd_export_llm(args: argparse.Namespace) -> int:
    inventory = load_inventory(inventory_path())
    payload = export_llm_context(
        inventory,
        tag=args.tag,
        media=args.media,
        min_items=args.min_items,
        limit=args.limit,
    )
    if args.out:
        Path(args.out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(json.dumps(payload, indent=2))
    return 0


def fetch_playability_status(url: str) -> dict:
    status_url = f"{url.rstrip('/')}/playability/status"
    try:
        with urllib.request.urlopen(status_url, timeout=8) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise SystemExit(f"playability status unavailable: {exc}") from exc


def cmd_absorb_hitrate(args: argparse.Namespace) -> int:
    report = Path(args.report)
    inventory = load_inventory(inventory_path())
    try:
        matched, total = absorb_hitrate_report(inventory, report)
    except FileNotFoundError:
        print(f"missing hitrate report: {report}", file=sys.stderr)
        print("run: MANGO_SOURCE_HITRATE_PER_SOURCE=5 python3 scripts/diag/source-hitrate.py", file=sys.stderr)
        return 2
    path = save_inventory(inventory, inventory_path())
    print(f"absorb-hitrate: {matched}/{total} sources → {path}")
    return 0


def cmd_absorb_pools(args: argparse.Namespace) -> int:
    inventory = load_inventory(inventory_path())
    status = fetch_playability_status(args.status_url)
    updated = absorb_pool_status(inventory, status)
    path = save_inventory(inventory, inventory_path())
    print(f"absorb-pools: {updated} catalogs ← {len(status.get('rails') or [])} rails → {path}")
    return 0


def cmd_measure(args: argparse.Namespace) -> int:
    report = Path(args.report)
    inventory = load_inventory(inventory_path())
    hit_matched = 0
    hit_total = 0
    if report.is_file():
        hit_matched, hit_total = absorb_hitrate_report(inventory, report)
    else:
        print(f"skip hitrate (no report at {report})", file=sys.stderr)
    try:
        status = fetch_playability_status(args.status_url)
        pool_updated = absorb_pool_status(inventory, status)
    except SystemExit:
        print("skip pools (catalog-service down)", file=sys.stderr)
        pool_updated = 0
    path = save_inventory(inventory, inventory_path())
    print(f"measure → {path}")
    print(f"  hitrate: {hit_matched}/{hit_total} catalogs")
    print(f"  pools:   {pool_updated} catalogs")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    inventory = load_inventory(inventory_path())
    cid = args.catalog_id
    if not cid.startswith("mdblist."):
        cid = f"mdblist.{cid}"
    for row in inventory.get("catalogs") or []:
        if row.get("catalog_id") == cid:
            print(json.dumps(row, indent=2))
            return 0
    print(f"not found: {cid}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="mdblist inventory tooling")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_sync = sub.add_parser("sync-toplists", help="Pull https://mdblist.com/toplists/ into inventory")
    p_sync.add_argument("--curated", action="store_true", help="Use /curatedlists/ instead")
    p_sync.set_defaults(func=cmd_sync_toplists)

    p_resolve = sub.add_parser("resolve", help="Resolve slug URLs to mdblist.N and merge")
    p_resolve.add_argument("slugs", nargs="+", help="user/list-slug paths")
    p_resolve.set_defaults(func=cmd_resolve)

    p_list = sub.add_parser("list", help="List inventory catalogs")
    p_list.add_argument("--tag", default=None)
    p_list.add_argument("--media", default=None, choices=["movie", "series", "mixed"])
    p_list.add_argument("--limit", type=int, default=50)
    p_list.set_defaults(func=cmd_list)

    p_export = sub.add_parser("export-llm", help="Compact JSON for LLM rail composition")
    p_export.add_argument("--tag", default=None)
    p_export.add_argument("--media", default=None, choices=["movie", "series", "mixed"])
    p_export.add_argument("--min-items", type=int, default=0)
    p_export.add_argument("--limit", type=int, default=80)
    p_export.add_argument("--out", default=None)
    p_export.set_defaults(func=cmd_export_llm)

    p_hit = sub.add_parser("absorb-hitrate", help="Merge source-hitrate report into inventory")
    p_hit.add_argument("--report", default=str(DEFAULT_HITRATE_REPORT))
    p_hit.set_defaults(func=cmd_absorb_hitrate)

    p_pool = sub.add_parser("absorb-pools", help="Merge playability pool depths into inventory")
    p_pool.add_argument("--status-url", default=DEFAULT_CATALOG_URL)
    p_pool.set_defaults(func=cmd_absorb_pools)

    p_measure = sub.add_parser("measure", help="absorb-hitrate + absorb-pools")
    p_measure.add_argument("--report", default=str(DEFAULT_HITRATE_REPORT))
    p_measure.add_argument("--status-url", default=DEFAULT_CATALOG_URL)
    p_measure.set_defaults(func=cmd_measure)

    p_show = sub.add_parser("show", help="Show one catalog entry")
    p_show.add_argument("catalog_id")
    p_show.set_defaults(func=cmd_show)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

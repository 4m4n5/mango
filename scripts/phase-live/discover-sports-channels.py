#!/usr/bin/env python3
"""Scan NexoTV catalog pages for sports-related live channels."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

KEYWORDS = re.compile(
    r"\b(cricket|soccer|football|f1|formula\s*1|premier\s*league|"
    r"sport|espn|sky\s*sport|bein|willow|star\s*sport|moto\s*gp|"
    r"bundesliga|la\s*liga|uefa|nfl|nba|mlb)\b",
    re.I,
)


def fetch(url: str, timeout: float) -> dict:
    req = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def main() -> int:
    parser = argparse.ArgumentParser(description="Discover sports channels in NexoTV catalog")
    parser.add_argument("--manifest-url", required=True)
    parser.add_argument("--pages", type=int, default=5, help="Catalog pages (skip steps of 100)")
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--timeout", type=float, default=45.0)
    args = parser.parse_args()

    base = args.manifest_url.removesuffix("/manifest.json")
    matches: list[dict] = []
    seen: set[str] = set()

    for page in range(args.pages):
        skip = page * 100
        url = f"{base}/catalog/tv/iptv_channels/skip={skip}.json"
        try:
            data = fetch(url, args.timeout)
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and page > 0:
                break
            raise
        metas = data.get("metas") or []
        if not metas:
            break
        for meta in metas:
            item_id = str(meta.get("id") or "")
            if not item_id or item_id in seen:
                continue
            seen.add(item_id)
            title = " ".join(
                str(meta.get(k) or "")
                for k in ("name", "title", "description", "genre")
            )
            if not KEYWORDS.search(title):
                continue
            matches.append({
                "id": item_id,
                "name": meta.get("name") or meta.get("title") or item_id,
                "poster": meta.get("poster"),
                "genre": meta.get("genre"),
            })
            if len(matches) >= args.limit:
                break
        if len(matches) >= args.limit:
            break

    print(json.dumps({
        "matched": len(matches),
        "channels": matches,
    }, indent=2))
    return 0 if matches else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Audit stream sources and debrid providers for mango diagnostics."""

from __future__ import annotations

import json
import re
import sys
import urllib.request

CATALOG = "http://127.0.0.1:3020"


def parse_bg(stream: dict) -> tuple[str, str]:
    hints = stream.get("behaviorHints") or {}
    bg = hints.get("bingeGroup") or ""
    parts = bg.split("|")
    svc = parts[1] if len(parts) > 1 else "?"
    cached = parts[2] if len(parts) > 2 else "?"
    return svc, cached


def analyze(type_: str, id_: str, label: str) -> None:
    print(f"\n=== {label} ({type_}/{id_}) ===")
    with urllib.request.urlopen(f"{CATALOG}/stream/{type_}/{id_}", timeout=90) as resp:
        data = json.loads(resp.read())
    filt = data.get("filters") or {}
    print(f"total={filt.get('total')} kept={filt.get('kept')} excluded={filt.get('excluded')}")
    by_source: dict[str, int] = {}
    by_svc: dict[str, int] = {}
    for stream in data.get("streams") or []:
        src = stream.get("source") or "?"
        by_source[src] = by_source.get(src, 0) + 1
        svc = stream.get("debrid_service") or parse_bg(stream)[0]
        by_svc[svc] = by_svc.get(svc, 0) + 1
    print("kept_by_source:", by_source)
    print("kept_by_debrid:", by_svc)
    for index, stream in enumerate((data.get("streams") or [])[:8]):
        svc, cached = parse_bg(stream)
        title = (stream.get("title") or stream.get("name") or "")[:48]
        print(
            f"  [{index}] {stream.get('source')} "
            f"svc={stream.get('debrid_service', svc)} "
            f"cache={stream.get('cache_status', cached)} "
            f"q={stream.get('quality', '?')} {title}"
        )


def addon_audit() -> None:
    with open("/etc/mango/stremio-export.json", encoding="utf-8") as handle:
        export = json.load(handle)
    print("--- addons ---")
    for addon in export.get("addons") or []:
        name = addon.get("name", "?")
        url = addon.get("manifestUrl") or addon.get("transportUrl") or ""
        has_rd = bool(re.search(r"realdebrid=", url, re.I))
        has_tb = bool(re.search(r"torbox=", url, re.I))
        print(f"  {name!r}: rd_configured={has_rd} tb_configured={has_tb}")


def main() -> int:
    addon_audit()
    titles = [
        ("movie", "tt0111161", "Shawshank"),
    ]
    try:
        with urllib.request.urlopen(f"{CATALOG}/rails/trending-india/items", timeout=60) as resp:
            items = json.loads(resp.read()).get("items") or []
        for item in items[:3]:
            titles.append((item["type"], item["id"], item.get("title", "?")))
    except Exception as error:  # noqa: BLE001
        print("trending-india fetch failed:", error)
    for type_, id_, label in titles:
        try:
            analyze(type_, id_, label)
        except Exception as error:  # noqa: BLE001
            print(f"FAILED {label}: {error}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

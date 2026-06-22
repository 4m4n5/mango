#!/usr/bin/env python3
"""Build config/live-cartoons.m3u from iptv-org kids category (classics-first)."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "config" / "live-cartoons.m3u"
SOURCE = "https://iptv-org.github.io/iptv/categories/kids.m3u"

# Order matters — catalog match_all takes first N channels in playlist order.
PICKS: list[tuple[str, Callable[[str], bool]]] = [
    ("Nickelodeon Clássico", lambda n: "clássico" in n or "classico" in n),
    ("Pluto TV Retro Toons", lambda n: n == "pluto tv retro toons"),
    ("Pluto TV Kids Classics", lambda n: n == "pluto tv kids classics"),
    ("Super! SpongeBob", lambda n: n == "super! spongebob"),
    ("Tom And Jerry", lambda n: n == "tom and jerry"),
    ("Xtrema Cartoons", lambda n: n == "xtrema cartoons"),
    ("Nickelodeon Pluto TV", lambda n: "nickelodeon pluto" in n),
    ("NickToons", lambda n: n == "nicktoons"),
    ("Nickelodeon", lambda n: n == "nickelodeon"),
    ("Nick Jr.", lambda n: n == "nick jr."),
    ("Nick Jr. Pluto TV", lambda n: n == "nick jr. pluto tv"),
    ("TeenNick", lambda n: n == "teennick"),
    ("Pluto TV Toons", lambda n: n in ("pluto tv toons (720p)", "pluto tv toons")),
    ("Pluto TV Kids", lambda n: n == "pluto tv kids"),
    ("Disney Channel", lambda n: n == "disney channel"),
    ("Disney Junior", lambda n: n == "disney junior"),
    ("Disney XD", lambda n: n == "disney xd"),
    ("PBS Kids", lambda n: n == "pbs kids eastern/central"),
    ("HappyKids", lambda n: n == "happykids"),
    ("Kartoon Channel", lambda n: n == "kartoon channel"),
    ("Moonbug Kids", lambda n: n == "moonbug kids"),
    ("LEGO Kids TV", lambda n: n == "lego kids tv"),
]


def load_blocks(url: str) -> list[tuple[str, str]]:
    text = subprocess.check_output(["curl", "-fsSL", url], timeout=120).decode("utf-8", errors="replace")
    blocks: list[tuple[str, str]] = []
    for block in re.split(r"(?=#EXTINF)", text):
        if not block.strip():
            continue
        lines = block.strip().splitlines()
        name = re.sub(r"\s*\[.*?\]\s*$", "", lines[0].rsplit(",", 1)[-1]).strip()
        name = re.sub(r"\s*\(\d+p\)\s*$", "", name).strip()
        urls = [ln.strip() for ln in lines[1:] if ln.strip().startswith("http")]
        if urls:
            blocks.append((name, block.strip()))
    return blocks


def normalize_name(name: str) -> str:
    return re.sub(r"\s*\(\d+p\)\s*$", "", name).strip().lower()


def main() -> int:
    blocks = load_blocks(SOURCE)
    lines = [
        "#EXTM3U",
        "# mango curated cartoons — classics-first (iptv-org)",
        "# https://github.com/iptv-org/iptv",
    ]
    missing: list[str] = []
    seen_urls: set[str] = set()

    for label, pred in PICKS:
        hit = None
        for name, block in blocks:
            if not pred(normalize_name(name)):
                continue
            url = next((ln for ln in block.splitlines()[1:] if ln.strip().startswith("http")), "")
            if not url or url in seen_urls:
                continue
            hit = (name, block, url)
            break
        if not hit:
            missing.append(label)
            continue
        seen_urls.add(hit[2])
        lines.extend(hit[1].splitlines())

    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({(len(lines) - 3) // 2} channels, {len(missing)} missing)")
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())

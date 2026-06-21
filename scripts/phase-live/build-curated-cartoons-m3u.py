#!/usr/bin/env python3
"""Build config/live-cartoons.m3u from iptv-org kids category."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "config" / "live-cartoons.m3u"
SOURCE = "https://iptv-org.github.io/iptv/categories/kids.m3u"

PICKS: list[tuple[str, str]] = [
    ("Nickelodeon", r"^nickelodeon$"),
    ("Nick Jr.", r"^nick jr\.$"),
    ("Nicktoons", r"^nicktoons$"),
    ("Nickelodeon Pluto TV", r"nickelodeon pluto"),
    ("Nick Jr. Pluto TV", r"nick jr\. pluto"),
    ("Disney Channel", r"^disney channel$"),
    ("Disney Junior", r"^disney junior$"),
    ("Disney XD", r"^disney xd$"),
    ("PBS Kids", r"^pbs kids eastern/central$"),
    ("Cartoon Classics", r"^cartoon classics$"),
    ("Tom And Jerry", r"^tom and jerry$"),
    ("Pluto TV Toons", r"^pluto tv toons$"),
    ("Pluto TV Kids", r"^pluto tv kids$"),
    ("TeenNick", r"^teennick$"),
    ("HappyKids", r"^happykids$"),
    ("Kartoon Channel", r"^kartoon channel$"),
    ("Moonbug Kids", r"^moonbug kids$"),
    ("LEGO Kids TV", r"^lego kids tv$"),
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


def main() -> int:
    blocks = load_blocks(SOURCE)
    lines = [
        "#EXTM3U",
        "# mango curated cartoons & kids — iptv-org sources",
        "# https://github.com/iptv-org/iptv",
    ]
    missing: list[str] = []

    for label, pattern in PICKS:
        rx = re.compile(pattern, re.I)
        hit = next(((name, block) for name, block in blocks if rx.search(name.lower())), None)
        if not hit:
            missing.append(label)
            continue
        lines.extend(hit[1].splitlines())

    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({(len(lines) - 3) // 2} channels, {len(missing)} missing)")
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())

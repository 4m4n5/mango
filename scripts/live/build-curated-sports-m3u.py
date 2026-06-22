#!/usr/bin/env python3
"""Build config/live-sports-curated.m3u from iptv-org playlists."""

from __future__ import annotations

import re
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "config" / "live-sports-curated.m3u"

PICKS: list[tuple[str, list[str]]] = [
    ("Cricket", [
        "Star Sports 1",
        "Star Sports 1 Hindi",
        "Star Sports 2 HD",
        "Willow",
        "Willow Sports",
        "DD Sports",
        "Cricket Gold",
    ]),
    ("Football", [
        "FIFA+ United States",
        "FIFA+",
        "beIN Sports USA",
    ]),
    ("Racing", [
        "FanDuel Racing",
        "FloRacing 24/7",
        "Rally TV",
        "Sky Racing 1",
        "Sky Racing 2",
    ]),
]

SOURCES = [
    "https://iptv-org.github.io/iptv/categories/sports.m3u",
    "https://iptv-org.github.io/iptv/countries/in.m3u",
]


def load_blocks(url: str) -> list[tuple[str, str]]:
    import subprocess
    text = subprocess.check_output(["curl", "-fsSL", url], timeout=120).decode("utf-8", errors="replace")
    blocks: list[tuple[str, str]] = []
    for block in re.split(r"(?=#EXTINF)", text):
        if not block.strip():
            continue
        lines = block.strip().splitlines()
        extinf = lines[0]
        name = re.sub(r"\s*\(\d+p\)\s*$", "", extinf.rsplit(",", 1)[-1]).strip()
        name = re.sub(r"\s*\[Geo-blocked\]\s*$", "", name, flags=re.I).strip()
        urls = [ln.strip() for ln in lines[1:] if ln.strip().startswith("http")]
        if urls:
            blocks.append((name, block.strip()))
    return blocks


def pick_block(blocks: list[tuple[str, str]], want: str) -> str | None:
    wl = want.lower()
    for name, block in blocks:
        if name.lower() == wl:
            return block
    for name, block in blocks:
        if name.lower().startswith(wl + " "):
            return block
    return None


def main() -> int:
    all_blocks: list[tuple[str, str]] = []
    for url in SOURCES:
        all_blocks.extend(load_blocks(url))

    lines = [
        "#EXTM3U",
        "# mango curated sports — cricket, football (FIFA/intl), racing",
        "# Sources: https://github.com/iptv-org/iptv",
    ]
    missing: list[str] = []

    for group, names in PICKS:
        for want in names:
            block = pick_block(all_blocks, want)
            if not block:
                missing.append(f"{group}:{want}")
                continue
            extinf = block.splitlines()[0]
            if "group-title=" not in extinf:
                extinf = extinf.replace("#EXTINF:-1 ", f'#EXTINF:-1 group-title="{group}" ', 1)
            lines.extend(block.splitlines())

    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(lines)} lines, {len(missing)} missing)")
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Build config/live-cartoons.m3u from iptv-org kids category (classics-first)."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "config" / "live-cartoons.m3u"
SOURCE = "https://iptv-org.github.io/iptv/categories/kids.m3u"
CHANNELS_SOURCE = "https://iptv-org.github.io/api/channels.json"
MAX_FAMILIES = 8

# Order matters — catalog match_all takes first N channels in playlist order.
# Keep this aligned with the exact english_hindi_cartoons qualification
# allowlist. Each row is one family and contributes at most one source stream.
PICKS: list[tuple[str, Callable[[str], bool]]] = [
    ("Tom And Jerry", lambda n: n == "tom and jerry"),
    ("Nickelodeon Pluto TV", lambda n: "nickelodeon pluto" in n),
    ("NickToons", lambda n: n == "nicktoons"),
    ("Nick Jr.", lambda n: n == "nick jr."),
    ("PBS Kids", lambda n: n == "pbs kids eastern/central"),
    ("HappyKids", lambda n: n == "happykids"),
    ("Kartoon Channel", lambda n: n == "kartoon channel"),
    ("Moonbug Kids", lambda n: n == "moonbug kids"),
]

LANGUAGE_LABELS = {
    "en": "English",
    "eng": "English",
    "english": "English",
    "hi": "Hindi",
    "hin": "Hindi",
    "hindi": "Hindi",
}

# Feed labels are source metadata (`channel.id@feed`), not display-name
# guesses. Refuse known localized feeds even if their base channel record is
# accidentally tagged English by the upstream data set.
KNOWN_FOREIGN_FEEDS = {
    "argentina", "brazil", "brasil", "bulgaria", "fr", "france", "germany",
    "italia", "italy", "latam", "mexico", "pl", "poland", "portugal", "spain",
}


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


def load_channel_languages(url: str) -> dict[str, tuple[str, ...]]:
    raw = subprocess.check_output(["curl", "-fsSL", url], timeout=120)
    parsed = json.loads(raw.decode("utf-8", errors="replace"))
    if not isinstance(parsed, list):
        raise ValueError("iptv-org channels metadata did not return a list")
    languages: dict[str, tuple[str, ...]] = {}
    for row in parsed:
        if not isinstance(row, dict):
            continue
        channel_id = row.get("id")
        values = row.get("languages")
        if not isinstance(channel_id, str) or not isinstance(values, list):
            continue
        cleaned = tuple(value.strip() for value in values if isinstance(value, str) and value.strip())
        if cleaned:
            languages[channel_id] = cleaned
    return languages


def normalize_name(name: str) -> str:
    return re.sub(r"\s*\(\d+p\)\s*$", "", name).strip().lower()


def extinf_attribute(block: str, attribute: str) -> str:
    first = block.splitlines()[0] if block else ""
    match = re.search(rf'\b{re.escape(attribute)}="([^"]*)"', first)
    return match.group(1).strip() if match else ""


def source_channel_id(block: str) -> tuple[str, str]:
    tvg_id = extinf_attribute(block, "tvg-id")
    base, separator, feed = tvg_id.partition("@")
    return base.strip(), feed.strip() if separator else ""


def approved_language_labels(values: tuple[str, ...] | list[str] | None) -> tuple[str, ...]:
    """Require positive and exclusively English/Hindi source evidence."""
    if not values:
        return ()
    labels: list[str] = []
    for value in values:
        label = LANGUAGE_LABELS.get(value.strip().lower())
        if not label:
            return ()
        if label not in labels:
            labels.append(label)
    return tuple(labels)


def with_language_attribute(block: str, languages: tuple[str, ...]) -> str:
    lines = block.splitlines()
    if not lines or not lines[0].startswith("#EXTINF"):
        return block
    extinf = re.sub(r'\s+tvg-language="[^"]*"', "", lines[0])
    before_name, separator, name = extinf.rpartition(",")
    if not separator:
        return block
    lines[0] = f'{before_name} tvg-language="{";".join(languages)}",{name}'
    return "\n".join(lines)


def select_blocks(
    blocks: list[tuple[str, str]],
    language_by_channel: dict[str, tuple[str, ...]],
) -> tuple[list[str], list[str]]:
    selected: list[str] = []
    missing: list[str] = []
    seen_urls: set[str] = set()
    for label, pred in PICKS:
        if len(selected) >= MAX_FAMILIES:
            break
        hit = None
        for name, block in blocks:
            if not pred(normalize_name(name)):
                continue
            channel_id, feed = source_channel_id(block)
            if not channel_id or feed.strip().lower() in KNOWN_FOREIGN_FEEDS:
                continue
            languages = approved_language_labels(language_by_channel.get(channel_id))
            if not languages:
                continue
            url = next((line.strip() for line in block.splitlines()[1:] if line.strip().startswith("http")), "")
            if not url or url in seen_urls:
                continue
            hit = (with_language_attribute(block, languages), url)
            break
        if not hit:
            missing.append(label)
            continue
        seen_urls.add(hit[1])
        selected.append(hit[0])
    return selected, missing


def build_playlist(
    blocks: list[tuple[str, str]],
    language_by_channel: dict[str, tuple[str, ...]],
) -> tuple[list[str], list[str]]:
    lines = [
        "#EXTM3U",
        "# mango curated cartoons — classics-first; explicit English/Hindi metadata only (iptv-org)",
        "# https://github.com/iptv-org/iptv",
    ]
    selected, missing = select_blocks(blocks, language_by_channel)
    for block in selected:
        lines.extend(block.splitlines())
    return lines, missing


def main() -> int:
    blocks = load_blocks(SOURCE)
    language_by_channel = load_channel_languages(CHANNELS_SOURCE)
    lines, missing = build_playlist(blocks, language_by_channel)

    if missing:
        print("missing:", ", ".join(missing), file=sys.stderr)

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    selected_count = len(PICKS) - len(missing)
    print(f"wrote {OUT} ({selected_count} channels, {len(missing)} ineligible/missing)")
    return 0 if selected_count > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

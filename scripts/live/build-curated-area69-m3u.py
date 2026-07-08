#!/usr/bin/env python3
"""Build a curated AREA69 Xtream M3U for NexoTV.

AREA69 exposes ~55k live streams across ~919 categories. NexoTV's Xtream
provider has no category filter and OOMs/restarts trying to index the full
catalog, so the paid addon's catalog comes up empty. This script fetches the
Xtream catalog once, filters to a curated set (cricket, soccer/FIFA, F1,
standard sports, news, cartoons), and emits a portable M3U with credentials
embedded in each stream URL. The M3U is written into the NexoTV data dir and
served over localhost HTTP (see scripts/live/serve-nexotv-data.sh) so NexoTV
can ingest it via its M3U provider (which only accepts HTTP(S) URLs).

Credentials are read from ~/.config/mango/area69.credentials (XTREAM_URL,
XTREAM_USER, XTREAM_PASS). The M3U itself is never committed — it lives only
on the Pi under the NexoTV data dir with mode 0600.

Usage:
  python3 scripts/live/build-curated-area69-m3u.py \\
      --out ~/.local/share/mango/nexotv/data/live-area69-curated.m3u
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from typing import Iterable

DEFAULT_CREDS = os.path.expanduser("~/.config/mango/area69.credentials")
DEFAULT_OUT = os.path.expanduser("~/.local/share/mango/nexotv/data/live-area69-curated.m3u")

# Curated channel groups: (group_title, [name-substring matches], per-group cap).
# Matches are case-insensitive substrings against the stream name (after the
# "US: " / "UK: " / country-prefix stripping). Channels matching earlier
# groups win (cricket > soccer > f1 > sports > news > cartoons).
# Compile one word-boundary regex per keyword so "liga" does not match "gilLIgan".
def compile_matches(keywords: list[str]) -> list[re.Pattern[str]]:
    pats = []
    for kw in keywords:
        esc = re.escape(kw)
        pats.append(re.compile(rf"(?<![a-z0-9]){esc}(?![a-z0-9])", re.IGNORECASE))
    return pats


GROUPS: list[tuple[str, list[str], int]] = [
    ("Cricket", ["willow cricket", "star sports", "cricket"], 12),
    ("Soccer & FIFA", ["fifa", "soccer", "uefa", "mls", "premier league", "la liga",
                       "bundesliga", "serie a", "champions league", "ligue 1"], 18),
    ("F1 & Racing", ["f1", "formula 1", "apple tv f1", "viaplay f1", "f1 tv", "motorsport"], 6),
    ("Sports", ["espn", "sky sports", "dazn", "fox sports", "tnt sports", "tbs sports",
                "nfl network", "nfl", "nba tv", "nba", "mlb network", "mlb", "nhl",
                "tennis", "golf", "ufc", "wwe", "olympic", "eurosport", "supersport"], 24),
    ("News", ["cnn", "bbc news", "bbc world", "fox news", "msnbc", "sky news",
              "india today", "ndtv", "republic", "times now", "al jazeera",
              "newsmax", "abc news", "nbc news", "cbs news"], 16),
    ("Cartoons & Kids", ["disney", "nick", "nickelodeon", "cartoon network", "cartoon",
                         "pbs kids", "boomerang", "teen titans", "tom and jerry",
                         "baby tv", "discovery kids", "sonic"], 16),
]
# Pre-compiled word-boundary matchers, aligned with GROUPS.
GROUP_MATCHERS: list[tuple[str, list[re.Pattern[str]], int]] = [
    (g, compile_matches(kws), cap) for g, kws, cap in GROUPS
]

# Event/EPG rows that are not standing channels — skip these.
EVENT_RE = re.compile(
    r"\bVS\.|VS\b|^NEXT\b|^\d+\s*am|^\d+\s*pm|: \d{1,2}:\d{2}|\(\d{4}-\d{2}-\d{2}|REPLAY|NO EVENT STREAMING|@\s+\w+\s+\d+\s+\d{1,2}:\d{2}\s*(AM|PM)",
    re.IGNORECASE,
)
# Noise placeholders NexoTV/Area69 wraps in ###/####/##### or dead PPV slots — not real channels.
NOISE_RE = re.compile(r"^#{2,}\s*|^\(FLSP|^\(MX\)|^-|^:[a-z]+\s+\d{2}$", re.IGNORECASE)


def load_creds(path: str) -> tuple[str, str, str]:
    if not os.path.isfile(path):
        sys.exit(f"missing credentials: {path}")
    url = user = pw = None
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip("'\"")
            if key == "XTREAM_URL":
                url = val
            elif key == "XTREAM_USER":
                user = val
            elif key == "XTREAM_PASS":
                pw = val
    if not (url and user and pw):
        sys.exit(f"{path} must set XTREAM_URL, XTREAM_USER, XTREAM_PASS")
    return url, user, pw


def api(base: str, user: str, pw: str, action: str, extra: str = "", timeout: int = 30) -> object:
    url = f"{base}/player_api.php?username={user}&password={pw}&action={action}{extra}"
    req = urllib.request.Request(url, headers={"User-Agent": "mango-area69-curate"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def clean_name(name: str) -> str:
    # Strip leading country/category prefix like "US: " or "UK: " for matching.
    return re.sub(r"^[A-Z]{2}:\s*", "", name or "").strip()


def pick_streams(streams: Iterable[dict]) -> list[tuple[str, str, str, str, str]]:
    """Return [(group, tvg_id, name, logo, url), ...] curated + deduped."""
    seen: set[str] = set()
    picked: list[tuple[str, str, str, str, str]] = []
    counts: dict[str, int] = {g: 0 for g, _, _ in GROUPS}
    # Prefer clean standing-channel names (no leading ### / parens) before noise.
    def sort_key(s: dict) -> tuple[int, str]:
        n = clean_name(s.get("name", "")).lower()
        noisy = 0 if (n and not NOISE_RE.match(n) and not n.startswith("(")) else 1
        return (noisy, n)
    sorted_streams = sorted(streams, key=sort_key)
    for s in sorted_streams:
        raw = s.get("name") or ""
        name = clean_name(raw)
        if not name or name in seen:
            continue
        if EVENT_RE.search(name) or NOISE_RE.match(name) or name.startswith("("):
            continue
        lname = name.lower()
        for group_title, matchers, cap in GROUP_MATCHERS:
            if counts[group_title] >= cap:
                continue
            if any(pat.search(lname) for pat in matchers):
                sid = str(s.get("stream_id") or "")
                if not sid:
                    break
                seen.add(name)
                counts[group_title] += 1
                picked.append((group_title, sid, name, s.get("stream_icon") or "", sid))
                break
    return picked


def build_search_index(streams: Iterable[dict]) -> list[dict]:
    """Return full-catalog search entries (noise/event rows filtered out)."""
    entries: list[dict] = []
    for s in streams:
        sid = str(s.get("stream_id") or "").strip()
        name = clean_name(s.get("name") or "")
        if not sid or not name:
            continue
        if EVENT_RE.search(name) or NOISE_RE.match(name) or name.startswith("("):
            continue
        entry: dict[str, str] = {
            "stream_id": sid,
            "name": name,
            "category_id": str(s.get("category_id") or ""),
        }
        logo = s.get("stream_icon") or ""
        if logo:
            entry["logo"] = logo
        entries.append(entry)
    return entries


def write_json_atomic(path: str, data: object) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--creds", default=DEFAULT_CREDS, help="area69.credentials path")
    ap.add_argument("--out", default=DEFAULT_OUT, help="output M3U path")
    ap.add_argument(
        "--index-out",
        default=None,
        help="search index JSON path (default: dirname(--out)/area69-live-search.json)",
    )
    ap.add_argument("--timeout", type=int, default=45, help="per-API-call timeout (s)")
    ap.add_argument("--show", action="store_true", help="print picked channels to stderr")
    args = ap.parse_args()
    index_out = args.index_out or os.path.join(os.path.dirname(args.out), "area69-live-search.json")

    base, user, pw = load_creds(args.creds)
    base = base.rstrip("/")

    print(f"fetching AREA69 live categories from {base} ...", file=sys.stderr)
    t0 = time.time()
    streams = api(base, user, pw, "get_live_streams", "", args.timeout)
    if not isinstance(streams, list):
        sys.exit(f"get_live_streams did not return a list: {type(streams).__name__}")
    print(f"  {len(streams)} streams in {time.time()-t0:.1f}s", file=sys.stderr)

    picked = pick_streams(streams)
    by_group: dict[str, int] = {}
    for g, _, _, _, _ in picked:
        by_group[g] = by_group.get(g, 0) + 1
    print(f"picked {len(picked)} channels: {by_group}", file=sys.stderr)
    if args.show:
        for g, sid, name, _, _ in picked:
            print(f"  [{g}] {sid} {name}", file=sys.stderr)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    lines = ["#EXTM3U"]
    for group, sid, name, logo, _ in picked:
        url = f"{base}/live/{user}/{pw}/{sid}.ts"
        tvg_id = sid
        logo_attr = f' tvg-logo="{logo}"' if logo else ""
        lines.append(
            f'#EXTINF:-1 tvg-id="{tvg_id}" tvg-name="{name}"{logo_attr} group-title="{group}",{name}'
        )
        lines.append(url)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, args.out)
    print(f"wrote {len(picked)} channels to {args.out} (mode 0600)", file=sys.stderr)

    index_entries = build_search_index(streams)
    write_json_atomic(
        index_out,
        {
            "version": 1,
            "built_at": int(time.time() * 1000),
            "source": "area69",
            "stream_count": len(index_entries),
            "entries": index_entries,
        },
    )
    print(f"wrote {len(index_entries)} entries to {index_out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

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

# Event/EPG rows are not standing channels, so keep excluding them from the
# compact NexoTV M3U. They are useful in the full search index, though: AREA69
# publishes current PPV/match streams under names such as "India VS England"
# or names containing a kickoff date. Index filtering is handled separately.
STANDING_CHANNEL_EVENT_RE = re.compile(
    r"\bVS\.|VS\b|^NEXT\b|^\d+\s*am|^\d+\s*pm|: \d{1,2}:\d{2}|\(\d{4}-\d{2}-\d{2}|REPLAY|NO EVENT STREAMING|@\s+\w+\s+\d+\s+\d{1,2}:\d{2}\s*(AM|PM)",
    re.IGNORECASE,
)
# Noise placeholders NexoTV/Area69 wraps in ###/####/##### or dead PPV slots — not real channels.
NOISE_RE = re.compile(r"^#{2,}\s*|^\(FLSP|^\(MX\)|^-|^:[a-z]+\s+\d{2}$", re.IGNORECASE)

# Full-index exclusions are deliberately conflict-only. Date and "vs" tokens
# identify useful current events and must not be treated as failures. Exclude
# only rows that explicitly say they are unavailable/over/replayed, bare slot
# placeholders, or clear episodic/VOD packs masquerading as live streams.
UNAVAILABLE_EVENT_RE = re.compile(
    r"\b(?:"
    r"no\s+(?:live\s+)?event(?:\s+streaming|\s+scheduled)?|"
    r"no\s+program(?:me)?|"
    r"replay|rerun|full\s+match|highlights?|"
    r"event\s+(?:has\s+)?(?:ended|finished|concluded|over)|"
    r"ended|finished|off[ -]?air|offline|"
    r"postponed|cancelled|canceled"
    r")\b",
    re.IGNORECASE,
)
PLACEHOLDER_RE = re.compile(
    r"^(?:"
    r"next(?:\s+event)?|upcoming(?:\s+event)?|"
    r"tba|tbd|to\s+be\s+(?:announced|confirmed)|"
    r"(?:ppv|event|channel)\s*#?\s*\d+|"
    r"\d{1,2}(?::\d{2})?\s*(?:am|pm)"
    r")\s*$|"
    r"\b(?:event\s+(?:starts?|coming)\b|please\s+stand\s+by)\b",
    re.IGNORECASE,
)
VOD_PACK_RE = re.compile(
    r"(?:"
    r"\bS\d{1,2}\s*E\d{1,3}\b|"
    r"\b(?:complete|full)\s+(?:season|series|box\s*set)\b|"
    r"\bseason\s+\d{1,2}\s+(?:complete|episodes?\b|pack\b)|"
    r"\bbox\s*set\b|"
    r"(?:^|\W)vod(?:\W|$)|"
    r"^(?:movie|series)\s*:|"
    r"\.(?:mkv|mp4|avi|mov|m4v|webm)\s*$"
    r")",
    re.IGNORECASE,
)
EVENT_HINT_RE = re.compile(
    r"\b(?:vs\.?|v)\b|"
    r"\b\d{4}-\d{2}-\d{2}\b|"
    r"\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b.*\b\d{1,2}(?::\d{2})?\b|"
    r"@\s+\w+\s+\d{1,2}\b",
    re.IGNORECASE,
)

SAFE_EVENT_FIELDS: dict[str, tuple[str, ...]] = {
    "event_id": ("event_id",),
    "status": ("event_status",),
    "starts_at": ("event_start", "start_timestamp", "start_time", "epg_start"),
    "ends_at": ("event_end", "end_timestamp", "end_time", "epg_end"),
    "competition": ("competition", "league", "tournament"),
    "home": ("home", "home_team"),
    "away": ("away", "away_team"),
}


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


def safe_scalar(value: object) -> str | int | float | bool | None:
    """Return non-secret scalar metadata suitable for the local index."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned or len(cleaned) > 256:
        return None
    lowered = cleaned.lower()
    # direct_source and similar provider data can contain embedded Xtream
    # credentials. Do not persist anything URL- or credential-shaped.
    if "://" in cleaned or "username=" in lowered or "password=" in lowered:
        return None
    return cleaned


def safe_text(value: object) -> str:
    scalar = safe_scalar(value)
    return scalar if isinstance(scalar, str) else ""


def safe_logo(value: object) -> str:
    """Keep ordinary artwork URLs while refusing credential-bearing URLs."""
    if not isinstance(value, str):
        return ""
    cleaned = value.strip()
    if not cleaned or len(cleaned) > 2048:
        return ""
    lowered = cleaned.lower()
    if any(marker in lowered for marker in (
        "username=", "password=", "?user=", "&user=", "?pass=", "&pass=",
    )):
        return ""
    if re.match(r"https?://[^/@\s]+:[^/@\s]+@", cleaned, re.IGNORECASE):
        return ""
    return cleaned


def event_metadata(stream: dict, name: str) -> dict[str, str | int | float | bool]:
    metadata: dict[str, str | int | float | bool] = {}
    for output_key, input_keys in SAFE_EVENT_FIELDS.items():
        for input_key in input_keys:
            value = safe_scalar(stream.get(input_key))
            if value is not None:
                metadata[output_key] = value
                break
    event_shaped = bool(EVENT_HINT_RE.search(name) or metadata)
    if event_shaped and "status" not in metadata:
        metadata["status"] = safe_scalar(stream.get("status")) or "listed"
    return metadata


def index_row_kind(stream: dict, name: str) -> str:
    if EVENT_HINT_RE.search(name) or event_metadata(stream, name):
        return "event"
    return "channel"


def should_index_stream(name: str) -> bool:
    if not name or NOISE_RE.match(name):
        return False
    if UNAVAILABLE_EVENT_RE.search(name) or PLACEHOLDER_RE.search(name):
        return False
    if VOD_PACK_RE.search(name):
        return False
    return True


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
        if STANDING_CHANNEL_EVENT_RE.search(name) or NOISE_RE.match(name) or name.startswith("("):
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
    """Return v2 full-catalog entries, including legitimate current events."""
    entries: list[dict] = []
    for s in streams:
        sid = str(s.get("stream_id") or "").strip()
        name = clean_name(s.get("name") or "")
        if not sid or not name:
            continue
        if not should_index_stream(name):
            continue
        entry: dict[str, object] = {
            "stream_id": sid,
            "name": name,
            "category_id": str(s.get("category_id") or ""),
            "kind": index_row_kind(s, name),
        }
        category = safe_text(s.get("category_name") or s.get("category") or s.get("group_title"))
        if category:
            entry["category"] = category
        logo = safe_logo(s.get("stream_icon"))
        if logo:
            entry["logo"] = logo
        epg_channel_id = safe_text(s.get("epg_channel_id"))
        if epg_channel_id:
            entry["epg_channel_id"] = epg_channel_id
        if entry["kind"] == "event":
            event = event_metadata(s, name)
            if event:
                entry["event"] = event
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
            "version": 2,
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

#!/usr/bin/env python3
"""Inventory AREA69 + curated M3U candidates for Live browse rails."""

from __future__ import annotations

import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

HOME = Path.home()
AREA69 = HOME / ".local/share/mango/nexotv/data/area69-live-search.json"
OUT = Path("/tmp/mango-live-theme-candidates.json")

# Exact standing allowlists mirrored from qualification.ts (canonical form).
ALLOWLISTS = {
    "cricket": {
        "star sports 1",
        "star sports 1 hindi",
        "star sports 2",
        "willow sports",
        "willow cricket",
        "dd sports",
        "cricket gold",
    },
    "f1": {"sky sports f1", "f1 tv", "dazn f1", "viaplay f1"},
    "news": {
        "ndtv 24x7",
        "india today",
        "wion",
        "times now",
        "aaj tak",
        "ndtv india",
        "abp news",
        "republic bharat",
        "bbc news",
        "sky news",
        "al jazeera english",
        "nbc news now",
    },
    "cartoons": {
        "tom and jerry",
        "nickelodeon pluto tv",
        "nicktoons",
        "nick jr",
        "pbs kids eastern central",
        "happykids",
        "kartoon channel",
        "moonbug kids",
    },
}

THEME_PATTERNS = {
    "cricket": [
        r"\bcricket\b",
        r"\bipl\b",
        r"\bwpl\b",
        r"\bwillow\b",
        r"\bstar sports\b",
        r"\bdd sports\b",
        r"\bsony sports?\b",
        r"\bsony ten\b",
        r"\bsony liv\b",
        r"\bss1\b",
        r"\bss2\b",
        r"\bt20\b",
        r"\btest match\b",
        r"\basia cup\b",
        r"\bchampions trophy\b",
        r"\bcc\b",
        r"\bindia\b.*\b(?:vs\.?|v\.?)\b",
        r"\b(?:vs\.?|v\.?)\b.*\bindia\b",
    ],
    "f1": [
        r"\bf1\b",
        r"\bformula\s*1\b",
        r"\bformula\s*one\b",
        r"\bsky sports f1\b",
        r"\bf1 tv\b",
        r"\bdazn f1\b",
        r"\bviaplay f1\b",
        r"\bapple tv.*f1\b",
    ],
    "news": [
        r"\bnews\b",
        r"\bndtv\b",
        r"\baaj tak\b",
        r"\brepublic\b",
        r"\bwion\b",
        r"\bbbc\b",
        r"\bal jazeera\b",
        r"\bsky news\b",
        r"\bcnn\b",
        r"\bindia today\b",
        r"\babp\b",
        r"\btimes now\b",
        r"\bzee news\b",
        r"\bnews18\b",
        r"\bcnn.?news18\b",
        r"\bptc news\b",
        r"\bdd news\b",
        r"\bcnbc\b",
        r"\bfox news\b",
        r"\bmsnbc\b",
        r"\bdw\b",
        r"\bfrance 24\b",
        r"\bnhk\b",
    ],
    "cartoons": [
        r"\bkids?\b",
        r"\bcartoon\b",
        r"\bnick(?:elodeon|toons| jr)?\b",
        r"\bpbs kids\b",
        r"\btom and jerry\b",
        r"\bhappykids\b",
        r"\bmoonbug\b",
        r"\bkartoon\b",
        r"\bdisney junior\b",
        r"\bpogo\b",
        r"\bhungama\b",
        r"\bcbeebies\b",
        r"\bbaby tv\b",
        r"\bsponge ?bob\b",
        r"\bdisney xd\b",
        r"\bdiscovery kids\b",
        r"\bsonic\b",
        r"\bnick hd\b",
    ],
}

EXCLUDE = re.compile(
    r"\b(?:24/?7|replay|ended?|highlights?|xxx|adult|porn|softcore)\b",
    re.I,
)
# Prefer standing channels / clean brand names over ephemeral PPV event rows.
EPHEMERAL = re.compile(r"^(?:live|next|end(?:ed)?)\s*[|:-]", re.I)
INDIA_HINT = re.compile(
    r"\b(?:india|hindi|star sports|sony|willow|dd sports|ndtv|aaj tak|republic|"
    r"wion|abp|times now|zee news|news18|pogo|hungama|sony yay)\b",
    re.I,
)


def canon(value: str) -> str:
    text = value.lower()
    text = re.sub(
        r"\b(?:8k(?:\s+exclusive)?|4320p?|4k|uhd|ultra\s+hd|2160p?|3840p?|fhd|"
        r"full\s+hd|1080p?|hd|720p?|sd|hevc|h\.?265|x265|raw)\b",
        " ",
        text,
    )
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def load_m3u(path: Path) -> list[str]:
    if not path.exists():
        return []
    names: list[str] = []
    pending: str | None = None
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("#EXTINF"):
            match = re.search(r'tvg-name="([^"]+)"', line)
            pending = match.group(1) if match else line.split(",")[-1].strip()
        elif line and not line.startswith("#") and pending:
            names.append(pending)
            pending = None
    return names


def brand_score(name: str, theme: str) -> tuple[int, str]:
    """Lower is better for standing-fill candidates."""
    key = canon(name)
    if EPHEMERAL.match(name.strip()):
        return (90, key)
    if theme == "cricket" and not INDIA_HINT.search(name) and "cricket" not in key:
        return (80, key)
    if theme == "news" and not INDIA_HINT.search(name) and not re.search(
        r"\b(?:bbc|sky news|al jazeera|nbc|cnn|dw|france 24|nhk|fox news|msnbc)\b",
        name,
        re.I,
    ):
        return (70, key)
    if "ppv" in key or "exclusive" in name.lower():
        return (60, key)
    return (10, key)


def main() -> int:
    entries = json.loads(AREA69.read_text(encoding="utf-8")).get("entries") or []
    print(f"area69_streams {len(entries)}")

    m3u_paths = {
        "sports_curated": HOME / "mango/config/live-sports-curated.m3u",
        "news_curated": HOME / "mango/config/live-news-hindi-english.m3u",
        "cartoons_curated": HOME / "mango/config/live-cartoons.m3u",
        "area69_curated": HOME / ".local/share/mango/nexotv/data/live-area69-curated.m3u",
    }
    for root_name, root in (
        ("free", HOME / ".local/share/mango/nexotv-free"),
        ("news", HOME / ".local/share/mango/nexotv-news"),
        ("cartoons", HOME / ".local/share/mango/nexotv-cartoons"),
    ):
        if root.is_dir():
            for path in sorted(root.rglob("*.m3u"))[:20]:
                m3u_paths[f"{root_name}:{path.name}"] = path

    m3u_names: dict[str, list[str]] = {}
    for label, path in m3u_paths.items():
        names = load_m3u(path)
        m3u_names[label] = names
        print(f"m3u {label}: {len(names)} ({path})")

    current: dict[str, list[str]] = defaultdict(list)
    with urllib.request.urlopen("http://127.0.0.1:3020/rails/items?tab=live", timeout=30) as resp:
        live = json.load(resp)
    for rail in live.get("rails") or []:
        label = str(rail.get("title") or rail.get("label") or rail.get("id"))
        for item in rail.get("items") or []:
            current[label].append(str(item.get("title") or item.get("name") or item.get("id")))
    print("CURRENT_RAILS")
    for label, titles in current.items():
        print(f"  {label}: {len(titles)}")
        for title in titles:
            print(f"    - {title}")

    current_keys = {
        theme: {canon(t) for t in titles}
        for theme, titles in (
            ("cricket", current.get("cricket", [])),
            ("f1", current.get("formula 1", [])),
            ("news", current.get("news", [])),
            ("cartoons", current.get("cartoons", [])),
        )
    }

    themed: dict[str, dict[str, dict]] = {theme: {} for theme in THEME_PATTERNS}

    def add_candidate(theme: str, name: str, source: str) -> None:
        if not name or EXCLUDE.search(name):
            return
        if theme == "cricket":
            # Keep India-leaning / cricket brands; drop unrelated STAR Sports US etc. later in ranking.
            low = name.lower()
            if not any(
                token in low
                for token in (
                    "cricket",
                    "ipl",
                    "wpl",
                    "willow",
                    "star sports",
                    "dd sports",
                    "sony sports",
                    "sony ten",
                    "india",
                )
            ):
                return
        key = canon(name)
        if not key:
            return
        bucket = themed[theme]
        score, _ = brand_score(name, theme)
        on_rail = key in current_keys.get(theme, set())
        allow_hit = key in ALLOWLISTS.get(theme, set()) or any(
            key == allowed or key.startswith(allowed + " ") for allowed in ALLOWLISTS.get(theme, set())
        )
        existing = bucket.get(key)
        if existing is None or score < existing["score"]:
            bucket[key] = {
                "name": name,
                "canonical": key,
                "source": source,
                "score": score,
                "on_rail_now": on_rail,
                "on_allowlist": allow_hit,
                "ephemeral": bool(EPHEMERAL.match(name.strip())),
            }

    for entry in entries:
        name = str(entry.get("name") or "")
        low = name.lower()
        for theme, patterns in THEME_PATTERNS.items():
            if any(re.search(pattern, low) for pattern in patterns):
                add_candidate(theme, name, "area69")

    for label, names in m3u_names.items():
        theme_hint = (
            "news"
            if "news" in label
            else "cartoons"
            if "cartoon" in label
            else "cricket"
            if "sport" in label or "area69" in label or "free" in label
            else None
        )
        for name in names:
            low = name.lower()
            matched = False
            for theme, patterns in THEME_PATTERNS.items():
                if any(re.search(pattern, low) for pattern in patterns):
                    add_candidate(theme, name, f"m3u:{label}")
                    matched = True
            if not matched and theme_hint:
                # Curated M3U rows are already hand-picked; still theme-check lightly.
                if theme_hint == "cricket" and re.search(r"sport|cricket|willow|star|dd ", low):
                    add_candidate("cricket", name, f"m3u:{label}")

    payload = {
        "current": {k: v for k, v in current.items()},
        "allowlists": {k: sorted(v) for k, v in ALLOWLISTS.items()},
        "themes": {},
    }
    for theme, bucket in themed.items():
        rows = sorted(bucket.values(), key=lambda row: (row["score"], row["canonical"]))
        payload["themes"][theme] = {
            "total_unique": len(rows),
            "on_rail": [row for row in rows if row["on_rail_now"]],
            "on_allowlist_not_on_rail": [
                row for row in rows if row["on_allowlist"] and not row["on_rail_now"]
            ],
            "standing_candidates": [
                row
                for row in rows
                if not row["on_rail_now"] and not row["ephemeral"] and row["score"] <= 20
            ][:80],
            "all_standing_like": [
                row for row in rows if not row["ephemeral"]
            ][:200],
            "ephemeral_events": [row for row in rows if row["ephemeral"]][:40],
        }
        print(
            f"{theme}: unique={len(rows)} "
            f"on_rail={len(payload['themes'][theme]['on_rail'])} "
            f"standing_candidates={len(payload['themes'][theme]['standing_candidates'])}"
        )

    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

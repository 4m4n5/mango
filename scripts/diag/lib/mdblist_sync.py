"""Fetch and parse mdblist.com list metadata for mango rail curation."""

from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

USER_AGENT = "mango-mdblist-sync/1.0"
BASE_URL = "https://mdblist.com"
DEFAULT_INVENTORY = Path(__file__).resolve().parents[3] / "config" / "mdblist-inventory.json"

TOPLISTS_URL = f"{BASE_URL}/toplists/"
CURATED_URL = f"{BASE_URL}/curatedlists/"

CARD_RE = re.compile(
    r'related-list-card">.*?href="/lists/([^"]+)".*?'
    r'related-list-meta__title">\s*<a[^>]*>([^<]+)</a>.*?'
    r'related-list-meta__user"[^>]*>([^<]+)</a>.*?'
    r'related-list-meta__type">([^<]+)</span>.*?'
    r'related-list-meta__items">(\d+) items</span>.*?'
    r'list=(\d+)',
    re.S,
)

LIST_ID_IMAGE_RE = re.compile(r"/media/list\.jpg\?id=(\d+)")
ITEMS_RE = re.compile(r"Items:\s*(\d+)")
TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.I)

MEDIA_MAP = {
    "movie": "movie",
    "show": "series",
}

TAG_KEYWORDS: list[tuple[str, str]] = [
    ("comedy", "comedy"),
    ("documentary", "documentary"),
    ("true crime", "true-crime"),
    ("horror", "horror"),
    ("sci-fi", "sci-fi"),
    ("science", "science"),
    ("netflix", "netflix"),
    ("hbo", "hbo"),
    ("disney", "disney"),
    ("amazon", "amazon"),
    ("hulu", "hulu"),
    ("stand up", "stand-up"),
    ("stand-up", "stand-up"),
    ("limited series", "limited-series"),
    ("miniseries", "limited-series"),
    ("trending", "trending"),
    ("latest", "trending"),
    ("imdb", "classics"),
    ("top 250", "classics"),
    ("anime", "anime"),
    ("crime", "crime"),
    ("thriller", "thriller"),
    ("war", "war"),
    ("family", "family"),
    ("animated", "animation"),
    ("mindfuck", "mindfuck"),
]


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
        if ctx.cert_store_stats().get("x509_ca", 0) == 0:
            return ssl._create_unverified_context()
        return ctx


def fetch_html(url: str, *, timeout: float = 25) -> str:
    req = urllib.request.Request(url, headers={"user-agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as resp:
        return resp.read().decode("utf-8", errors="replace")


def decode_entities(text: str) -> str:
    return (
        text.replace("&#x27;", "'")
        .replace("&amp;", "&")
        .replace("&gt;", ">")
        .replace("&lt;", "<")
        .replace("&quot;", '"')
        .strip()
    )


def infer_tags(name: str, curator: str, media: str) -> list[str]:
    tags: list[str] = ["toplists"]
    lower = name.lower()
    for needle, tag in TAG_KEYWORDS:
        if needle in lower:
            tags.append(tag)
    if media == "series":
        tags.append("series")
    elif media == "movie":
        tags.append("movie")
    else:
        tags.append("mixed")
    curator_lower = curator.lower()
    if curator_lower in {"snoak", "gary"}:
        tags.append("official-snoak" if curator_lower == "snoak" else "community")
    if "hd movie lists" in curator_lower or curator_lower == "hdlists":
        tags.append("community")
    item_count_hint = re.search(r"(\d+)\s*items", lower)
    tags.append("global")
    return sorted(set(tags))


@dataclass
class MdbListEntry:
    catalog_id: str
    numeric_id: int
    slug: str
    name: str
    curator: str
    media: str
    items: int
    popularity: int | None = None
    url: str = ""
    source: str = "toplists"
    trakt_sync: bool = False
    tags: list[str] = field(default_factory=list)

    def to_inventory_catalog(
        self,
        *,
        existing: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        base = existing or {}
        hit_rate = base.get("hit_rate") or {"status": "unprobed"}
        rails = list(base.get("rails") or [])
        tags = sorted(set((base.get("tags") or []) + self.tags))
        if "deployed" in tags and "candidate" in tags:
            tags = [t for t in tags if t != "candidate"]
        if not rails and "deployed" not in tags:
            tags = sorted(set(tags + ["candidate"]))
        return {
            "catalog_id": self.catalog_id,
            "slug": self.slug,
            "url": self.url or f"{BASE_URL}/lists/{self.slug}",
            "name": self.name,
            "items": self.items,
            "media": self.media,
            "curator": self.curator,
            "popularity": self.popularity,
            "source": self.source,
            "tags": tags,
            "hit_rate": hit_rate,
            "rails": rails,
        }


def parse_toplists_html(html: str, *, source: str = "toplists") -> list[MdbListEntry]:
    entries: list[MdbListEntry] = []
    seen: set[str] = set()
    for match in CARD_RE.finditer(html):
        slug, title, curator, media_raw, items_s, list_id_s = match.groups()
        if slug.startswith("official/"):
            continue
        if slug in seen:
            continue
        seen.add(slug)
        media = MEDIA_MAP.get(media_raw.strip().lower(), "mixed")
        numeric_id = int(list_id_s)
        likes_match = re.search(
            rf'href="/lists/{re.escape(slug)}".*?related-list-meta__likes">\s*<span[^>]*>(\d+)',
            html[match.start(): match.start() + 4000],
            re.S,
        )
        popularity = int(likes_match.group(1)) if likes_match else None
        name = decode_entities(title)
        entry = MdbListEntry(
            catalog_id=f"mdblist.{numeric_id}",
            numeric_id=numeric_id,
            slug=slug,
            name=name,
            curator=decode_entities(curator),
            media=media,
            items=int(items_s),
            popularity=popularity,
            url=f"{BASE_URL}/lists/{slug}",
            source=source,
            tags=infer_tags(name, curator, media),
        )
        entries.append(entry)
    return entries


def fetch_toplists(*, curated: bool = False) -> list[MdbListEntry]:
    url = CURATED_URL if curated else TOPLISTS_URL
    source = "curatedlists" if curated else "toplists"
    html = fetch_html(url)
    return parse_toplists_html(html, source=source)


def resolve_slug(slug: str) -> MdbListEntry | None:
    slug = slug.removeprefix("/lists/").strip("/")
    url = f"{BASE_URL}/lists/{slug}"
    try:
        html = fetch_html(url)
    except urllib.error.HTTPError:
        return None
    image_match = LIST_ID_IMAGE_RE.search(html)
    if not image_match:
        return None
    numeric_id = int(image_match.group(1))
    items_match = ITEMS_RE.search(html)
    title_match = TITLE_RE.search(html)
    name = decode_entities(title_match.group(1).split(" - ")[0]) if title_match else slug
    parts = slug.split("/", 1)
    curator = parts[0] if parts else ""
    return MdbListEntry(
        catalog_id=f"mdblist.{numeric_id}",
        numeric_id=numeric_id,
        slug=slug,
        name=name,
        curator=curator,
        media="mixed",
        items=int(items_match.group(1)) if items_match else 0,
        url=url,
        source="slug-resolve",
        tags=["community"],
    )


def load_inventory(path: Path | None = None) -> dict[str, Any]:
    inv_path = path or DEFAULT_INVENTORY
    if not inv_path.is_file():
        return {
            "_comment": "Tagged MDBList catalog inventory for mango rail composition.",
            "_updated": None,
            "tags": {},
            "catalogs": [],
            "toplists_snapshots": [],
            "rail_proposals": {},
        }
    return json.loads(inv_path.read_text(encoding="utf-8"))


def save_inventory(data: dict[str, Any], path: Path | None = None) -> Path:
    inv_path = path or DEFAULT_INVENTORY
    data["_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    inv_path.parent.mkdir(parents=True, exist_ok=True)
    inv_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return inv_path


def merge_catalogs(
    inventory: dict[str, Any],
    entries: list[MdbListEntry],
    *,
    preserve_hit_rate: bool = True,
) -> tuple[int, int]:
    by_id: dict[str, dict[str, Any]] = {
        str(row.get("catalog_id")): row for row in inventory.get("catalogs") or []
    }
    added = 0
    updated = 0
    for entry in entries:
        existing = by_id.get(entry.catalog_id)
        merged = entry.to_inventory_catalog(existing=existing if preserve_hit_rate else None)
        if existing:
            if preserve_hit_rate:
                merged["hit_rate"] = existing.get("hit_rate") or merged.get("hit_rate")
                merged["rails"] = existing.get("rails") or []
            updated += 1
        else:
            added += 1
        by_id[entry.catalog_id] = merged
    inventory["catalogs"] = sorted(
        by_id.values(),
        key=lambda row: (row.get("catalog_id") or ""),
    )
    return added, updated


def record_snapshot(
    inventory: dict[str, Any],
    entries: list[MdbListEntry],
    *,
    source: str,
) -> None:
    snapshots: list[dict[str, Any]] = list(inventory.get("toplists_snapshots") or [])
    snapshots.append({
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "count": len(entries),
        "catalog_ids": [entry.catalog_id for entry in entries],
    })
    inventory["toplists_snapshots"] = snapshots[-20:]


def export_llm_context(
    inventory: dict[str, Any],
    *,
    tag: str | None = None,
    media: str | None = None,
    min_items: int = 0,
    limit: int = 80,
) -> dict[str, Any]:
    rows = []
    for catalog in inventory.get("catalogs") or []:
        if tag and tag not in (catalog.get("tags") or []):
            continue
        if media and catalog.get("media") != media:
            continue
        items = catalog.get("items") or 0
        if items < min_items:
            continue
        hit = catalog.get("hit_rate") or {}
        rows.append({
            "catalog_id": catalog.get("catalog_id"),
            "name": catalog.get("name"),
            "media": catalog.get("media"),
            "items": items,
            "tags": catalog.get("tags"),
            "source_hit_rate": hit.get("source"),
            "source_n": hit.get("source_n"),
            "pool_verified": hit.get("pool_verified"),
            "recommendation": hit.get("notes"),
            "status": hit.get("status") or ("deployed" if catalog.get("rails") else "candidate"),
            "rails": catalog.get("rails"),
            "popularity": catalog.get("popularity"),
        })
    rows.sort(
        key=lambda row: (
            -(row.get("source_hit_rate") or 0),
            -(row.get("popularity") or 0),
            -(row.get("items") or 0),
        ),
    )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "rails_per_tab": 6,
            "target_source_hit_rate": 0.8,
            "composite_weight_sum": 1.0,
        },
        "catalogs": rows[:limit],
        "active_rails": _active_rails_from_inventory(inventory),
    }


def _active_rails_from_inventory(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    rails: dict[str, list[str]] = {}
    for catalog in inventory.get("catalogs") or []:
        cid = catalog.get("catalog_id")
        for rail_id in catalog.get("rails") or []:
            rails.setdefault(rail_id, []).append(cid)
    return [{"rail_id": rid, "catalogs": cids} for rid, cids in sorted(rails.items())]


def entry_to_dict(entry: MdbListEntry) -> dict[str, Any]:
    return asdict(entry)


def _catalog_key(addon: str, catalog: str) -> str:
    if addon == "AIOMetadata" and catalog.startswith(("mdblist.", "custom.")):
        return catalog
    return f"{addon}.{catalog}"


def absorb_hitrate_report(
    inventory: dict[str, Any],
    report_path: Path,
    *,
    measured_date: str | None = None,
) -> tuple[int, int]:
    """Merge source-hitrate latest.json into inventory catalog hit_rate fields."""
    if not report_path.is_file():
        raise FileNotFoundError(report_path)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    measured = measured_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    by_id: dict[str, dict[str, Any]] = {
        str(row.get("catalog_id")): row for row in inventory.get("catalogs") or []
    }
    matched = 0
    for source in report.get("sources") or []:
        addon = str(source.get("addon") or "")
        catalog = str(source.get("catalog") or "")
        if not catalog:
            continue
        key = _catalog_key(addon, catalog)
        if not key.startswith(("mdblist.", "custom.")):
            continue
        row = by_id.get(key)
        if not row:
            continue
        sampled = int(source.get("sampled") or 0)
        hit_rate = dict(row.get("hit_rate") or {})
        hit_rate["source"] = source.get("stream_rate")
        hit_rate["source_n"] = sampled
        hit_rate["measured"] = measured
        if source.get("recommendation"):
            hit_rate["notes"] = source["recommendation"]
        if sampled > 0:
            hit_rate.pop("status", None)
        row["hit_rate"] = hit_rate
        matched += 1
    inventory["catalogs"] = sorted(by_id.values(), key=lambda row: row.get("catalog_id") or "")
    inventory["last_hitrate_absorb"] = {
        "at": datetime.now(timezone.utc).isoformat(),
        "report": str(report_path),
        "matched": matched,
        "seed": report.get("seed"),
    }
    return matched, len(report.get("sources") or [])


def absorb_pool_status(
    inventory: dict[str, Any],
    status: dict[str, Any],
    *,
    measured_date: str | None = None,
) -> int:
    """Set pool_verified on catalogs from playability rail status (max across rails)."""
    measured = measured_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rail_verified = {
        str(row.get("rail_id")): int(row.get("verified_pool") or 0)
        for row in status.get("rails") or []
    }
    updated = 0
    for row in inventory.get("catalogs") or []:
        rails = row.get("rails") or []
        if not rails:
            continue
        depths = [rail_verified[r] for r in rails if r in rail_verified]
        if not depths:
            continue
        hit_rate = dict(row.get("hit_rate") or {})
        hit_rate["pool_verified"] = max(depths)
        hit_rate["pool_measured"] = measured
        row["hit_rate"] = hit_rate
        updated += 1
    inventory["last_pool_absorb"] = {
        "at": datetime.now(timezone.utc).isoformat(),
        "rails": len(rail_verified),
        "catalogs_updated": updated,
    }
    return updated

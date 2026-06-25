#!/usr/bin/env python3
"""Per-source catalog hit-rate — probe stream resolve (and optional play) for tuning rails.

Samples candidates directly from each addon catalog referenced in catalog.yaml,
aggregates hit-rate by source, and writes a report for continuous curation.

Usage:
  python3 scripts/diag/source-hitrate.py
  MANGO_SOURCE_HITRATE_PER_SOURCE=8 MANGO_SOURCE_HITRATE_PLAY=1 python3 scripts/diag/source-hitrate.py

Env:
  MANGO_CATALOG_URL          catalog-service base (default http://127.0.0.1:3020)
  MANGO_CATALOG_YAML         rail config (default repo config/catalog.example.yaml)
  MANGO_STREMIO_EXPORT       addon manifests (default /etc/mango/stremio-export.json)
  MANGO_SOURCE_HITRATE_PER_SOURCE  samples per catalog (default 5)
  MANGO_SOURCE_HITRATE_PLAY  1 = also POST /play (default 0 — stream resolve only)
  MANGO_SOURCE_HITRATE_SEED  random seed
  MANGO_SOURCE_TARGET_RATE   goal for summary warning (default 0.80)
  MANGO_SOURCE_MIN_RATE      fail exit if any active source below (default 0.50)
  MANGO_SOURCE_HITRATE_OUT   report path (default ~/.cache/mango/source-hitrate/latest.json)
  MANGO_SOURCE_HITRATE_SOURCE_KEYS comma-separated source keys to probe (default all)
  MANGO_SOURCE_HITRATE_MERGE_CACHE 1 = merge probed rows into existing OUT report
"""

from __future__ import annotations

import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

try:
    import yaml
except ImportError:
    print("source-hitrate: PyYAML required", file=sys.stderr)
    raise SystemExit(2)

CATALOG = os.environ.get("MANGO_CATALOG_URL", "http://127.0.0.1:3020")
REPO = Path(os.environ.get("MANGO_REPO_DIR", os.path.expanduser("~/mango")))
CATALOG_YAML = Path(
    os.environ.get("MANGO_CATALOG_YAML", REPO / "config" / "catalog.example.yaml"),
)
STREMIO_EXPORT = Path(os.environ.get("MANGO_STREMIO_EXPORT", "/etc/mango/stremio-export.json"))
CATALOG_INDEX = REPO / "config" / "aiometadata-rail-catalogs.json"
PER_SOURCE = int(os.environ.get("MANGO_SOURCE_HITRATE_PER_SOURCE", "5"))
DO_PLAY = os.environ.get("MANGO_SOURCE_HITRATE_PLAY", "0") == "1"
SEED = int(os.environ.get("MANGO_SOURCE_HITRATE_SEED", str(int(time.time()))))
TARGET_RATE = float(os.environ.get("MANGO_SOURCE_TARGET_RATE", "0.80"))
MIN_RATE = float(os.environ.get("MANGO_SOURCE_MIN_RATE", "0.50"))
OUT_PATH = Path(
    os.environ.get(
        "MANGO_SOURCE_HITRATE_OUT",
        os.path.expanduser("~/.cache/mango/source-hitrate/latest.json"),
    ),
)
MPV_STOP = ["bash", "scripts/m2-catalog/service/mpv-stop.sh"]
EXPORT_JSON = Path(os.environ.get("MANGO_AIOMETADATA_EXPORT", ""))
PROBE_EXPORT = os.environ.get("MANGO_SOURCE_PROBE_EXPORT", "0") == "1"
FILTER_SOURCE_KEYS = {
    key.strip()
    for key in os.environ.get("MANGO_SOURCE_HITRATE_SOURCE_KEYS", "").split(",")
    if key.strip()
}
MERGE_CACHE = os.environ.get("MANGO_SOURCE_HITRATE_MERGE_CACHE", "0") == "1"
CINEMETA_CATALOG_ROOT = os.environ.get(
    "MANGO_CINEMETA_CATALOG_ROOT",
    "https://cinemeta-catalogs.strem.io/top/catalog",
)


def _emit_preflight_progress(done: int, total: int, catalog: str) -> None:
    label = catalog[:60]
    print(f"grow-run: preflight {done}/{total} {label}", flush=True)
    if os.environ.get("MANGO_GROW_RUN_STATE") != "1":
        return
    try:
        from grow_run_state import touch_preflight_progress

        touch_preflight_progress(done, total, catalog)
    except Exception:
        pass


@dataclass
class SourceRef:
    addon: str
    catalog: str
    content_type: str
    weight: float = 1.0
    rails: list[str] = field(default_factory=list)


@dataclass
class SourceStats:
    source_key: str
    addon: str
    catalog: str
    content_type: str
    name: str
    rails: list[str]
    sampled: int = 0
    stream_ok: int = 0
    play_ok: int = 0
    errors: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    @property
    def stream_rate(self) -> float:
        return self.stream_ok / self.sampled if self.sampled else 0.0

    @property
    def play_rate(self) -> float:
        return self.play_ok / self.sampled if self.sampled else 0.0


def fetch_json(url: str, *, method: str = "GET", body: dict | None = None, timeout: float = 90) -> dict:
    data = None
    headers = {
        "accept": "application/json",
        "user-agent": "Stremio/4.0 (mango-source-hitrate)",
    }
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def cinemeta_catalog_url(content_type: str, catalog_id: str) -> str:
    return f"{CINEMETA_CATALOG_ROOT}/{urllib.parse.quote(content_type)}/{urllib.parse.quote(catalog_id)}.json"


def load_manifests() -> dict[str, str]:
    raw = json.loads(STREMIO_EXPORT.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for addon in raw.get("addons") or []:
        name = str(addon.get("name") or "").strip()
        url = addon.get("manifestUrl") or addon.get("transportUrl") or addon.get("url")
        if name and url:
            out[name] = str(url)
    return out


def catalog_resource_url(manifest_url: str, content_type: str, catalog_id: str) -> str:
    parsed = urllib.parse.urlparse(manifest_url)
    root = parsed.path.replace("/manifest.json", "").rstrip("/")
    path = f"{root}/catalog/{urllib.parse.quote(content_type)}/{urllib.parse.quote(catalog_id)}.json"
    return urllib.parse.urlunparse(parsed._replace(path=path, query="", fragment=""))


def load_catalog_index() -> dict[str, str]:
    names: dict[str, str] = {}
    if CATALOG_INDEX.is_file():
        data = json.loads(CATALOG_INDEX.read_text(encoding="utf-8"))
        for entry in data.get("catalogs") or []:
            cid = str(entry.get("id") or "")
            if cid:
                names[cid] = str(entry.get("name") or cid)
    if EXPORT_JSON.is_file():
        data = json.loads(EXPORT_JSON.read_text(encoding="utf-8"))
        for entry in (data.get("config") or data).get("catalogs") or []:
            cid = str(entry.get("id") or "")
            if cid and cid not in names:
                names[cid] = str(entry.get("name") or cid)
    return names


def load_export_catalog_sources() -> dict[str, SourceRef]:
    """All enabled movie/series catalogs from AIOMetadata export (for discovery probes)."""
    if not EXPORT_JSON.is_file():
        return {}
    data = json.loads(EXPORT_JSON.read_text(encoding="utf-8"))
    catalogs = (data.get("config") or data).get("catalogs") or []
    sources: dict[str, SourceRef] = {}
    for entry in catalogs:
        if entry.get("enabled") is False:
            continue
        content_type = str(entry.get("type") or "")
        if content_type not in ("movie", "series"):
            continue
        cid = str(entry.get("id") or "")
        if not cid:
            continue
        if cid.startswith("tmdb."):
            addon = "Cinemeta"
            catalog = {"tmdb.top": "top", "tmdb.top_rated": "imdbRating"}.get(cid, cid)
        elif cid.startswith("mdblist.") or cid.startswith("custom."):
            addon = "AIOMetadata"
            catalog = cid
        else:
            continue
        key = f"{addon}|{catalog}|{content_type}"
        sources[key] = SourceRef(addon=addon, catalog=catalog, content_type=content_type, rails=["(export)"])
    return sources


def source_row_key(row: dict) -> str | None:
    source_key = row.get("source_key")
    if source_key:
        return str(source_key)
    addon = row.get("addon")
    catalog = row.get("catalog")
    content_type = row.get("content_type")
    if addon and catalog and content_type:
        return f"{addon}|{catalog}|{content_type}"
    return None


def summary_from_source_rows(rows: list[dict]) -> dict:
    sampled = sum(int(row.get("sampled") or 0) for row in rows)
    stream_ok = sum(int(row.get("stream_ok") or 0) for row in rows)
    play_ok = sum(int(row.get("play_ok") or 0) for row in rows)
    return {
        "sources": len(rows),
        "sampled": sampled,
        "stream_ok": stream_ok,
        "stream_rate": stream_ok / sampled if sampled else 0,
        "play_ok": play_ok,
        "play_rate": play_ok / sampled if sampled else 0,
    }


def merge_with_cached_report(
    report: dict,
    configured_keys: set[str],
    probed_keys: set[str],
) -> dict:
    if not MERGE_CACHE or not OUT_PATH.is_file():
        return report
    try:
        previous = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return report

    previous_sources = {
        key: row
        for row in previous.get("sources") or []
        if isinstance(row, dict)
        for key in [source_row_key(row)]
        if key
    }
    current_sources = {
        key: row
        for row in report.get("sources") or []
        if isinstance(row, dict)
        for key in [source_row_key(row)]
        if key
    }
    merged_sources = [
        current_sources.get(key) or previous_sources[key]
        for key in sorted(configured_keys)
        if key in current_sources or key in previous_sources
    ]

    previous_picks = [
        pick for pick in previous.get("picks") or []
        if isinstance(pick, dict) and str(pick.get("source_key") or "") not in probed_keys
    ]
    report["sources"] = merged_sources
    report["picks"] = previous_picks + list(report.get("picks") or [])
    report["summary"] = summary_from_source_rows(merged_sources)
    report["incremental"] = {
        "merged_cache": True,
        "configured_sources": len(configured_keys),
        "probed_sources": len(probed_keys),
    }
    return report


def load_sources_from_yaml() -> dict[str, SourceRef]:
    data = yaml.safe_load(CATALOG_YAML.read_text(encoding="utf-8"))
    sources: dict[str, SourceRef] = {}
    for rail in data.get("rails") or []:
        if rail.get("enabled") is False:
            continue
        rail_id = rail.get("id")
        if not rail_id:
            continue
        content_type = str(rail.get("content_type") or "movie")
        rail_type = rail.get("type")
        refs: list[tuple[str, str, float]] = []
        if rail_type == "addon_catalog":
            refs.append((str(rail["addon"]), str(rail["catalog"]), 1.0))
        elif rail_type == "composite_list":
            for src in rail.get("sources") or []:
                refs.append((str(src["addon"]), str(src["catalog"]), float(src.get("weight") or 1)))
        else:
            continue
        for addon, catalog, weight in refs:
            key = f"{addon}|{catalog}|{content_type}"
            if key not in sources:
                sources[key] = SourceRef(addon=addon, catalog=catalog, content_type=content_type, weight=weight)
            if rail_id not in sources[key].rails:
                sources[key].rails.append(rail_id)
    return sources


def fetch_catalog_metas(addon: str, manifest_url: str, content_type: str, catalog_id: str, limit: int) -> list[dict]:
    if addon == "Cinemeta":
        url = cinemeta_catalog_url(content_type, catalog_id)
        data = fetch_json(url, timeout=30)
    else:
        url = catalog_resource_url(manifest_url, content_type, catalog_id)
        data = fetch_json(url, timeout=30)
    metas = data.get("metas") or []
    out: list[dict] = []
    for meta in metas[:limit]:
        if not isinstance(meta, dict):
            continue
        mid = meta.get("id")
        if not mid:
            continue
        out.append({
            "type": content_type,
            "id": str(mid),
            "title": str(meta.get("name") or mid),
        })
    return out


def probe_stream(pick: dict) -> tuple[bool, str | None]:
    try:
        data = fetch_json(f"{CATALOG}/stream/{pick['type']}/{pick['id']}", timeout=90)
        kept = int((data.get("filters") or {}).get("kept") or 0)
        if kept > 0:
            return True, None
        return False, "no_streams_after_filter"
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        try:
            err = json.loads(body)
            msg = str(err.get("error") or body[:120])
        except json.JSONDecodeError:
            msg = body[:120]
        return False, msg
    except Exception as exc:
        return False, str(exc)[:120]


def probe_play(pick: dict) -> bool:
    import subprocess

    subprocess.run(MPV_STOP, cwd=REPO, capture_output=True)
    try:
        data = fetch_json(
            f"{CATALOG}/play",
            method="POST",
            body={"type": pick["type"], "id": pick["id"]},
            timeout=150,
        )
        return data.get("ok") is True
    except Exception:
        return False
    finally:
        subprocess.run(MPV_STOP, cwd=REPO, capture_output=True)


def recommend(stats: SourceStats) -> str | None:
    rate = stats.play_rate if DO_PLAY else stats.stream_rate
    if stats.sampled == 0:
        return "no samples — check manifest / catalog id"
    if rate >= TARGET_RATE:
        return None
    if rate < MIN_RATE:
        return "swap or demote — below minimum viable rate"
    if stats.addon == "AIOMetadata" and stats.catalog.startswith("mdblist."):
        return "try Cinemeta chart blend or trending mdblist sibling"
    if "indiastreams" in stats.catalog:
        return "verify IndiaStreams endpoint; compare recmov vs popmov vs trendingtv"
    if stats.addon == "Cinemeta":
        return "usually strong — check stream plane health if rate dropped"
    return f"tune weight down or increase ingest_multiplier on rails: {', '.join(stats.rails)}"


def main() -> int:
    if not CATALOG_YAML.is_file():
        print(f"source-hitrate: missing {CATALOG_YAML}", file=sys.stderr)
        return 2

    manifests = load_manifests()
    catalog_names = load_catalog_index()
    if PROBE_EXPORT and EXPORT_JSON.is_file():
        sources = load_export_catalog_sources()
        print(f"mode: export probe ({EXPORT_JSON})")
    else:
        sources = load_sources_from_yaml()
        print("mode: active rails")
    configured_keys = set(sources)
    if FILTER_SOURCE_KEYS:
        missing = sorted(FILTER_SOURCE_KEYS - configured_keys)
        if missing:
            print(f"warn: {len(missing)} requested source keys not in catalog config")
        sources = {
            key: source
            for key, source in sources.items()
            if key in FILTER_SOURCE_KEYS
        }
        print(f"mode: filtered sources ({len(sources)}/{len(configured_keys)})")
    rng = random.Random(SEED)

    print("========== mango source hit-rate ==========")
    print(f"sources={len(sources)} per_source={PER_SOURCE} play={DO_PLAY} seed={SEED}")
    print(f"target={TARGET_RATE:.0%} min={MIN_RATE:.0%}")
    print()

    all_stats: list[SourceStats] = []
    all_picks: list[dict] = []
    source_items = sorted(sources.items(), key=lambda item: item[0])
    total_sources = len(source_items)

    processed_sources = 0
    for key, ref in source_items:
        processed_sources += 1
        name = catalog_names.get(ref.catalog, ref.catalog)
        stats = SourceStats(
            source_key=key,
            addon=ref.addon,
            catalog=ref.catalog,
            content_type=ref.content_type,
            name=name,
            rails=ref.rails,
        )
        manifest = manifests.get(ref.addon)
        if ref.addon != "Cinemeta" and not manifest:
            print(f"SKIP {key}: no manifest for addon {ref.addon}")
            stats.errors[f"no manifest for addon {ref.addon}"] += 1
            all_stats.append(stats)
            _emit_preflight_progress(processed_sources, total_sources, ref.catalog)
            continue
        try:
            metas = fetch_catalog_metas(
                ref.addon,
                manifest or "",
                ref.content_type,
                ref.catalog,
                limit=max(PER_SOURCE * 3, 15),
            )
        except Exception as exc:
            print(f"SKIP {key}: catalog fetch failed — {exc}")
            stats.errors[f"catalog fetch failed: {str(exc)[:80]}"] += 1
            all_stats.append(stats)
            _emit_preflight_progress(processed_sources, total_sources, ref.catalog)
            continue
        if not metas:
            print(f"SKIP {key}: empty catalog")
            stats.errors["empty catalog"] += 1
            all_stats.append(stats)
            _emit_preflight_progress(processed_sources, total_sources, ref.catalog)
            continue
        sample = metas if len(metas) <= PER_SOURCE else rng.sample(metas, PER_SOURCE)
        for pick in sample:
            stats.sampled += 1
            stream_ok, err = probe_stream(pick)
            if stream_ok:
                stats.stream_ok += 1
            elif err:
                stats.errors[err[:60]] += 1
            play_ok = False
            if DO_PLAY and stream_ok:
                play_ok = probe_play(pick)
                if play_ok:
                    stats.play_ok += 1
            all_picks.append({
                **pick,
                "source_key": key,
                "addon": ref.addon,
                "catalog": ref.catalog,
                "stream_ok": stream_ok,
                "play_ok": play_ok,
                "error": err,
            })
        all_stats.append(stats)
        _emit_preflight_progress(processed_sources, total_sources, ref.catalog)

    metric = "play" if DO_PLAY else "stream"
    print(f"{'source':42} {'rails':>4} {'n':>3} {'stream':>8} {'play':>8}  note")
    print("-" * 90)
    total_n = total_stream = total_play = 0
    below_min: list[SourceStats] = []
    below_target: list[SourceStats] = []

    for stats in sorted(all_stats, key=lambda s: s.stream_rate):
        total_n += stats.sampled
        total_stream += stats.stream_ok
        total_play += stats.play_ok
        rate = stats.play_rate if DO_PLAY else stats.stream_rate
        if rate < MIN_RATE:
            below_min.append(stats)
        if rate < TARGET_RATE:
            below_target.append(stats)
        rec = recommend(stats)
        play_col = f"{stats.play_ok}/{stats.sampled}" if DO_PLAY else "—"
        flag = " !" if rate < MIN_RATE else (" ~" if rate < TARGET_RATE else "")
        print(
            f"{stats.catalog[:42]:42} {len(stats.rails):4d} {stats.sampled:3d} "
            f"{stats.stream_ok}/{stats.sampled:>2} {play_col:>8}{flag}  "
            f"{(rec or 'ok')[:32]}"
        )

    if total_n:
        print("-" * 90)
        overall_stream = total_stream / total_n
        print(
            f"{'TOTAL':42} {'':4} {total_n:3d} "
            f"{total_stream}/{total_n} ({overall_stream:.0%})"
            + (f"  play {total_play}/{total_n} ({total_play/total_n:.0%})" if DO_PLAY else "")
        )

    print()
    if below_target:
        print(f"Below {TARGET_RATE:.0%} {metric} target ({len(below_target)} sources):")
        for stats in below_target:
            rate = stats.play_rate if DO_PLAY else stats.stream_rate
            print(f"  - {stats.catalog} ({rate:.0%}) → rails {stats.rails}")

    report = {
        "ts": int(time.time()),
        "seed": SEED,
        "per_source": PER_SOURCE,
        "play": DO_PLAY,
        "target_rate": TARGET_RATE,
        "min_rate": MIN_RATE,
        "catalog_yaml": str(CATALOG_YAML),
        "summary": {
            "sources": len(all_stats),
            "sampled": total_n,
            "stream_ok": total_stream,
            "stream_rate": total_stream / total_n if total_n else 0,
            "play_ok": total_play,
            "play_rate": total_play / total_n if total_n else 0,
        },
        "sources": [
            {
                "source_key": s.source_key,
                "addon": s.addon,
                "catalog": s.catalog,
                "name": s.name,
                "content_type": s.content_type,
                "rails": s.rails,
                "sampled": s.sampled,
                "stream_ok": s.stream_ok,
                "stream_rate": s.stream_rate,
                "play_ok": s.play_ok,
                "play_rate": s.play_rate,
                "errors": dict(s.errors),
                "recommendation": recommend(s),
            }
            for s in all_stats
        ],
        "picks": all_picks,
    }
    report = merge_with_cached_report(
        report,
        configured_keys,
        {stats.source_key for stats in all_stats},
    )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    history = OUT_PATH.parent / "history.jsonl"
    with history.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "ts": report["ts"],
            "seed": SEED,
            "stream_rate": report["summary"]["stream_rate"],
            "play_rate": report["summary"]["play_rate"],
            "sources_below_target": len(below_target),
            "sources_below_min": len(below_min),
        }) + "\n")
    print(f"\nwritten {OUT_PATH}")
    print(f"appended {history}")

    if below_min:
        return 2
    overall = (total_play / total_n if DO_PLAY else total_stream / total_n) if total_n else 0
    if overall < TARGET_RATE:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

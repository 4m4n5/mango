#!/usr/bin/env python3
"""Compact operator digest of rails missing their nightly grow target.

Mirrors the consecutive-miss escalation logic in
src/catalog-service/src/reliability/model.ts (computeStarvingRails) so the
same "starving rails" list that trips the Reliability Center's Rail Growth
component to yellow can be inspected directly from the ops cache, without
hitting the catalog-service HTTP API. Operator-only diagnostic — this never
surfaces on the TV.

A rail is "starving" once it has missed its nightly/grow +N target for
MANGO_RAIL_MISS_NIGHTS (default 3) consecutive refresh nights, walking the
refresh-playability-*.json history written under $XDG_CACHE_HOME/mango/ops
by scripts/diag/extract_refresh_json.py. A night where the rail meets its
target resets that rail's streak to zero, same as the TypeScript model.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_THRESHOLD_NIGHTS = 3
DEFAULT_GROW_TARGET = 20
REFRESH_JSON_GLOB = "refresh-playability-*.json"
RAIL_GROWTH_MAX_DATES = 120
AI_CATALOG_RAIL_PREFIX = "ai-"


def cache_dir() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "mango"


def ops_dir() -> Path:
    override = os.environ.get("MANGO_OPS_DIR")
    if override:
        return Path(override).expanduser()
    return cache_dir() / "ops"


def threshold_nights() -> int:
    raw = os.environ.get("MANGO_RAIL_MISS_NIGHTS", str(DEFAULT_THRESHOLD_NIGHTS))
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_THRESHOLD_NIGHTS
    return value if value > 0 else DEFAULT_THRESHOLD_NIGHTS


def _catalog_yaml_path(
    repo_example: Path | None = None,
    device_config: Path | None = None,
) -> Path:
    override = os.environ.get("MANGO_CATALOG_YAML")
    if override:
        return Path(override).expanduser()
    repo_example = repo_example or (
        Path(__file__).resolve().parents[2] / "config" / "catalog.example.yaml"
    )
    device_config = device_config or Path("/etc/mango/catalog.yaml")
    # Match CatalogCore's runtime authority: an installed device config owns
    # the active rails even when it intentionally differs from the repo
    # example. The checked-in example is only the non-device fallback.
    if device_config.is_file():
        return device_config
    return repo_example


def active_vod_rail_ids(
    catalog_path: Path | None = None,
    ai_catalogs_dir: Path | None = None,
) -> set[str]:
    """Load the same configured Movie/TV rail identities used by VOD grow."""
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover - Pi/setup prerequisite
        raise RuntimeError("PyYAML is required to resolve active VOD rails") from exc

    path = catalog_path or _catalog_yaml_path()
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, ValueError, yaml.YAMLError) as exc:
        raise RuntimeError(f"could not read active catalog configuration: {path}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"active catalog configuration is not an object: {path}")

    active: set[str] = set()
    for row in payload.get("rails") or []:
        if not isinstance(row, dict) or row.get("enabled") is False:
            continue
        if row.get("type") not in {"addon_catalog", "composite_list"}:
            continue
        tab = row.get("tab")
        if tab not in {"movies", "series"}:
            continue
        rail_id = row.get("id")
        if isinstance(rail_id, str) and rail_id.strip():
            active.add(rail_id.strip())

    ai_root = ai_catalogs_dir or Path(
        os.environ.get("MANGO_AI_CATALOGS_DIR", "/etc/mango/ai-catalogs"),
    ).expanduser()
    slots_dir = ai_root / "slots"
    try:
        slot_paths = sorted((*slots_dir.glob("*.yaml"), *slots_dir.glob("*.yml")))
        ai_rows = [yaml.safe_load(slot.read_text(encoding="utf-8")) or {} for slot in slot_paths]
        if any(not isinstance(row, dict) for row in ai_rows):
            ai_rows = []
    except (OSError, ValueError, yaml.YAMLError):
        # CatalogCore drops the whole optional AI slot set when loading it fails.
        ai_rows = []
    for row in ai_rows:
        if not isinstance(row, dict) or row.get("enabled") is False:
            continue
        if row.get("tab") not in {"movies", "series"}:
            continue
        slot_id = row.get("slot_id")
        if isinstance(slot_id, str) and slot_id.strip():
            bare = slot_id.strip()
            active.add(bare if bare.startswith(AI_CATALOG_RAIL_PREFIX) else f"{AI_CATALOG_RAIL_PREFIX}{bare}")
    return active


def _refresh_json_paths(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        path for path in directory.glob(REFRESH_JSON_GLOB)
        if not path.name.endswith("-deferred.json")
    )


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _night_timestamp(path: Path, payload: dict[str, Any]) -> float:
    for key in ("finished_at", "started_at"):
        value = payload.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    try:
        return path.stat().st_mtime * 1000
    except OSError:
        return 0.0


def _night_rail_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    mode = payload.get("mode")
    if mode not in ("grow", "nightly"):
        return []
    if (
        payload.get("ok") is not True
        or payload.get("maintenance_rc") != 0
        or payload.get("all_rails_publishable") is not True
        or not isinstance(payload.get("finished_at"), (int, float))
        or payload["finished_at"] <= 0
    ):
        return []
    rails = payload.get("rails")
    if not isinstance(rails, list):
        return []
    rows: list[dict[str, Any]] = []
    for row in rails:
        if not isinstance(row, dict) or not row.get("rail_id"):
            continue
        grow_target_raw = row.get("grow_target")
        grow_target = int(grow_target_raw) if isinstance(grow_target_raw, (int, float)) else DEFAULT_GROW_TARGET
        fresh_raw = row.get("new_to_rail_verified")
        if fresh_raw is None:
            fresh_raw = row.get("fresh_verified")
        if fresh_raw is None:
            fresh_raw = row.get("probe_verified")
        fresh = int(fresh_raw) if isinstance(fresh_raw, (int, float)) else 0
        met_raw = row.get("grow_target_met")
        met = met_raw if isinstance(met_raw, bool) else fresh >= grow_target
        rows.append({
            "rail_id": str(row["rail_id"]),
            "grow_target": grow_target,
            "new_to_rail_verified": fresh,
            "grow_target_met": met,
        })
    return rows


def load_rail_growth_history(
    directory: Path | None = None,
    active_rail_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Final completed, publishable refresh per local calendar date, oldest first."""
    directory = directory or ops_dir()
    by_local_date: dict[str, dict[str, Any]] = {}
    for path in _refresh_json_paths(directory):
        payload = _load_json(path)
        if payload is None:
            continue
        rows = _night_rail_rows(payload)
        if active_rail_ids is not None:
            rows = [row for row in rows if row["rail_id"] in active_rail_ids]
        if not rows:
            continue
        generated_at = _night_timestamp(path, payload)
        if generated_at <= 0:
            continue
        local_date = datetime.fromtimestamp(generated_at / 1000).date().isoformat()
        previous = by_local_date.get(local_date)
        if previous is None or generated_at >= previous["generated_at"]:
            by_local_date[local_date] = {"generated_at": generated_at, "rails": rows}
    return sorted(by_local_date.values(), key=lambda night: night["generated_at"])[-RAIL_GROWTH_MAX_DATES:]


def compute_starving_rails(
    history: list[dict[str, Any]],
    threshold: int = DEFAULT_THRESHOLD_NIGHTS,
) -> list[dict[str, Any]]:
    """Same consecutive-miss walk as reliability/model.ts computeStarvingRails."""
    per_rail: dict[str, dict[str, Any]] = {}
    for night in history:
        for rail in night["rails"]:
            rail_id = rail["rail_id"]
            met = bool(rail["grow_target_met"])
            previous_misses = per_rail.get(rail_id, {}).get("misses", 0)
            per_rail[rail_id] = {
                "misses": 0 if met else previous_misses + 1,
                "last_yield": rail["new_to_rail_verified"],
                "grow_target": rail["grow_target"],
                "last_checked_at": night["generated_at"],
            }
    starving = [
        {
            "rail_id": rail_id,
            "nights_missed": info["misses"],
            "last_yield": info["last_yield"],
            "grow_target": info["grow_target"],
            "last_checked_at": info["last_checked_at"],
        }
        for rail_id, info in per_rail.items()
        if info["misses"] >= threshold
    ]
    starving.sort(key=lambda rail: (-rail["nights_missed"], rail["rail_id"]))
    return starving


def format_starving_rails(starving: list[dict[str, Any]], threshold: int, nights_recorded: int) -> str:
    if not starving:
        return (
            f"Starving rails: none (0 of {nights_recorded} recorded night(s) show a "
            f"{threshold}+ night miss streak)\n"
        )
    lines = [f"Starving rails ({len(starving)}) — missed grow target {threshold}+ consecutive nights:"]
    for rail in starving:
        lines.append(
            f"  {rail['rail_id']}: missed {rail['nights_missed']}n, last +{rail['last_yield']}/{rail['grow_target']}",
        )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--threshold-nights",
        type=int,
        default=None,
        help="override MANGO_RAIL_MISS_NIGHTS (default 3)",
    )
    args = parser.parse_args(argv)

    threshold = args.threshold_nights if args.threshold_nights else threshold_nights()
    try:
        active_rails = active_vod_rail_ids()
    except RuntimeError as exc:
        raise SystemExit(f"rail health unavailable: {exc}") from exc
    if not active_rails:
        raise SystemExit("rail health unavailable: active VOD rail configuration is empty")
    history = load_rail_growth_history(active_rail_ids=active_rails)
    starving = compute_starving_rails(history, threshold)

    if args.json:
        print(json.dumps({
            "threshold_nights": threshold,
            "nights_recorded": len(history),
            "starving_rails": starving,
        }, indent=2))
        return 0

    print(format_starving_rails(starving, threshold, len(history)))
    print(f"(nights recorded: {len(history)} · ops dir: {ops_dir()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

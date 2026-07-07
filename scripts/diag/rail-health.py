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
from pathlib import Path
from typing import Any

DEFAULT_THRESHOLD_NIGHTS = 3
DEFAULT_GROW_TARGET = 20
REFRESH_JSON_GLOB = "refresh-playability-*.json"


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
    if mode not in (None, "grow", "nightly"):
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


def load_rail_growth_history(directory: Path | None = None) -> list[dict[str, Any]]:
    """Chronological (oldest-first) per-night rail rows from refresh-playability-*.json."""
    directory = directory or ops_dir()
    nights: list[dict[str, Any]] = []
    for path in _refresh_json_paths(directory):
        payload = _load_json(path)
        if payload is None:
            continue
        rows = _night_rail_rows(payload)
        if not rows:
            continue
        nights.append({"generated_at": _night_timestamp(path, payload), "rails": rows})
    nights.sort(key=lambda night: night["generated_at"])
    return nights


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
    history = load_rail_growth_history()
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

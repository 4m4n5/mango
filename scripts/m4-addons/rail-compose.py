#!/usr/bin/env python3
"""Apply LLM rail composition JSON to catalog yaml + inventory + AIOMetadata index.

Usage:
  python3 scripts/m4-addons/rail-compose.py validate proposal.json
  python3 scripts/m4-addons/rail-compose.py plan proposal.json
  python3 scripts/m4-addons/rail-compose.py apply proposal.json [--write]

Proposal format: config/rail-compose.schema.json

Env:
  MANGO_CATALOG_YAML         default config/catalog.example.yaml
  MANGO_MDBLIST_INVENTORY    default config/mdblist-inventory.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts" / "diag"))

from lib.mdblist_sync import load_inventory, save_inventory  # noqa: E402

SCHEMA_PATH = REPO / "config" / "rail-compose.schema.json"
RAIL_INDEX_PATH = REPO / "config" / "aiometadata-rail-catalogs.json"
PROPOSALS_DIR = REPO / "config" / "rail-proposals"

CINEMETA_SOURCE = re.compile(r"^Cinemeta\.(top|imdbRating)$")


def catalog_yaml_path() -> Path:
    return Path(os.environ.get("MANGO_CATALOG_YAML", REPO / "config" / "catalog.example.yaml"))


def inventory_path() -> Path:
    return Path(os.environ.get("MANGO_MDBLIST_INVENTORY", REPO / "config" / "mdblist-inventory.json"))


def load_proposal(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_proposal(proposal: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if proposal.get("version") != 1:
        errors.append("version must be 1")
    rails = proposal.get("rails")
    if not isinstance(rails, list) or not rails:
        errors.append("rails must be a non-empty array")
        return errors

    for idx, rail in enumerate(rails):
        prefix = f"rails[{idx}]"
        if not isinstance(rail, dict):
            errors.append(f"{prefix}: must be object")
            continue
        rail_id = rail.get("rail_id")
        if not rail_id or not re.match(r"^[a-z][a-z0-9-]*$", str(rail_id)):
            errors.append(f"{prefix}: invalid rail_id")
        sources = rail.get("sources")
        if not isinstance(sources, list) or not sources:
            errors.append(f"{prefix}: sources required")
            continue
        weight_sum = 0.0
        for sidx, source in enumerate(sources):
            sp = f"{prefix}.sources[{sidx}]"
            cid = str(source.get("catalog_id") or "")
            weight = source.get("weight")
            if not cid:
                errors.append(f"{sp}: catalog_id required")
                continue
            if not CINEMETA_SOURCE.match(cid) and not re.match(r"^mdblist\.\d+$", cid):
                errors.append(f"{sp}: catalog_id must be mdblist.N or Cinemeta.top|imdbRating")
            if not isinstance(weight, (int, float)) or weight <= 0 or weight > 1:
                errors.append(f"{sp}: weight must be in (0, 1]")
            else:
                weight_sum += float(weight)
        if abs(weight_sum - 1.0) > 0.02:
            errors.append(f"{prefix}: source weights sum to {weight_sum:.3f} (expected ~1.0)")
    return errors


def normalize_source(source: dict[str, Any]) -> dict[str, Any]:
    cid = str(source["catalog_id"])
    if CINEMETA_SOURCE.match(cid):
        chart = cid.split(".", 1)[1]
        return {"addon": "Cinemeta", "catalog": chart, "weight": float(source["weight"])}
    addon = source.get("addon") or "AIOMetadata"
    return {"addon": addon, "catalog": cid, "weight": float(source["weight"])}


def classify_rail(sources: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    normalized = [normalize_source(source) for source in sources]
    mdblist_only = all(row["addon"] == "AIOMetadata" for row in normalized)
    if mdblist_only and len(normalized) == 1:
        return "addon_catalog", normalized
    return "composite_list", normalized


def format_source_yaml(source: dict[str, Any]) -> str:
    weight = source["weight"]
    return (
        f"{{ addon: {source['addon']}, catalog: {source['catalog']}, "
        f"weight: {weight:g} }}"
    )


def build_rail_yaml_block(rail: dict[str, Any], existing: dict[str, Any] | None) -> str:
    rail_id = rail["rail_id"]
    existing = existing or {}
    rail_type, sources = classify_rail(rail["sources"])
    tab = rail.get("tab") or existing.get("tab") or "movies"
    label = rail.get("label") or existing.get("label") or rail_id
    content_type = rail.get("content_type") or existing.get("content_type") or (
        "movie" if tab == "movies" else "series"
    )
    playability = existing.get("playability") or {
        "display_limit": 20,
        "min_display": 20,
        "pool_target": 20,
        "pool_growth_per_refresh": 10,
        "pool_max": 120,
        "display_max": 28,
        "ingest_multiplier": 8 if rail_type == "composite_list" else 10,
    }
    limit = existing.get("limit", 20)

    lines = [
        f"  - id: {rail_id}",
        f"    tab: {tab}",
        f"    label: {label}",
        f"    type: {rail_type}",
    ]
    if rail_type == "addon_catalog":
        row = sources[0]
        lines += [
            f"    addon: {row['addon']}",
            f"    catalog: {row['catalog']}",
            f"    content_type: {content_type}",
            f"    limit: {limit}",
        ]
    else:
        lines.append(f"    content_type: {content_type}")
        lines.append(f"    limit: {limit}")
        lines.append("    sources:")
        for row in sources:
            lines.append(f"      - {format_source_yaml(row)}")
    lines.append("    playability:")
    for key, value in playability.items():
        lines.append(f"      {key}: {value}")
    return "\n".join(lines) + "\n"


def parse_rails_from_yaml(text: str) -> dict[str, dict[str, Any]]:
    try:
        import yaml
    except ImportError:
        return {}
    data = yaml.safe_load(text) or {}
    rails = data.get("rails") or []
    return {str(rail.get("id")): rail for rail in rails if rail.get("id")}


def replace_rail_in_yaml(text: str, rail_id: str, new_block: str) -> str:
    pattern = re.compile(
        rf"^  - id: {re.escape(rail_id)}\n.*?(?=^  - id: |^  - id: continue|\Z)",
        re.M | re.S,
    )
    if not pattern.search(text):
        raise SystemExit(f"rail not found in yaml: {rail_id}")
    block = new_block.rstrip("\n") + "\n"
    return pattern.sub(block, text, count=1)


def update_rail_index(proposal: dict[str, Any], inventory: dict[str, Any]) -> dict[str, Any]:
    by_catalog: dict[str, dict[str, Any]] = {}
    for catalog in inventory.get("catalogs") or []:
        cid = catalog.get("catalog_id")
        if cid:
            by_catalog[cid] = catalog

    for rail in proposal["rails"]:
        rail_id = rail["rail_id"]
        for source in rail["sources"]:
            cid = source["catalog_id"]
            if CINEMETA_SOURCE.match(cid):
                continue
            row = by_catalog.setdefault(cid, {
                "catalog_id": cid,
                "name": cid,
                "tags": ["candidate"],
                "hit_rate": {"status": "unprobed"},
                "rails": [],
            })
            rails = list(row.get("rails") or [])
            if rail_id not in rails:
                rails.append(rail_id)
            row["rails"] = rails
            tags = set(row.get("tags") or [])
            tags.add("deployed")
            tags.discard("candidate")
            row["tags"] = sorted(tags)

    index_data = {
        "_comment": "AIOMetadata catalog ids referenced by config/catalog.example.yaml. Regenerate: rail-compose.py apply",
        "addon": "AIOMetadata",
        "catalogs": [],
    }
    mdblist_ids = sorted(
        cid for cid in by_catalog if str(cid).startswith("mdblist.") and by_catalog[cid].get("rails")
    )
    for cid in mdblist_ids:
        row = by_catalog[cid]
        index_data["catalogs"].append({
            "id": cid,
            "name": row.get("name") or cid,
            "rails": row.get("rails") or [],
        })
    return index_data


def cmd_validate(args: argparse.Namespace) -> int:
    proposal = load_proposal(args.proposal)
    errors = validate_proposal(proposal)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print("OK: proposal valid")
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    proposal = load_proposal(args.proposal)
    errors = validate_proposal(proposal)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    yaml_path = catalog_yaml_path()
    text = yaml_path.read_text(encoding="utf-8")
    existing_rails = parse_rails_from_yaml(text)

    print(f"proposal: {args.proposal}")
    if proposal.get("description"):
        print(f"description: {proposal['description']}")
    print()

    for rail in proposal["rails"]:
        rail_id = rail["rail_id"]
        rail_type, sources = classify_rail(rail["sources"])
        print(f"## {rail_id} ({rail_type})")
        if rail.get("rationale"):
            print(f"   {rail['rationale']}")
        for source in sources:
            print(f"   - {source['addon']} {source['catalog']} weight={source['weight']}")
        block = build_rail_yaml_block(rail, existing_rails.get(rail_id))
        print()
        print(block.rstrip())
        print()

    missing = []
    inventory = load_inventory(inventory_path())
    known = {row.get("catalog_id") for row in inventory.get("catalogs") or []}
    for rail in proposal["rails"]:
        for source in rail["sources"]:
            cid = source["catalog_id"]
            if not CINEMETA_SOURCE.match(cid) and cid not in known:
                missing.append(cid)
    if missing:
        print("WARN: catalogs not in inventory (import into AIOMetadata before deploy):")
        for cid in sorted(set(missing)):
            print(f"  {cid}")
    return 0


def is_low_risk_proposal(proposal: dict[str, Any], yaml_text: str) -> bool:
    existing = set(re.findall(r"^  - id: (\S+)", yaml_text, re.M))
    for rail in proposal.get("rails") or []:
        if rail.get("new_rail"):
            return False
        if rail.get("rail_id") not in existing:
            return False
    return True


def cmd_apply(args: argparse.Namespace) -> int:
    proposal = load_proposal(args.proposal)
    errors = validate_proposal(proposal)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    yaml_path = catalog_yaml_path()
    text = yaml_path.read_text(encoding="utf-8")
    existing_rails = parse_rails_from_yaml(text)

    for rail in proposal["rails"]:
        block = build_rail_yaml_block(rail, existing_rails.get(rail["rail_id"]))
        text = replace_rail_in_yaml(text, rail["rail_id"], block)

    inventory = load_inventory(inventory_path())
    index_data = update_rail_index(proposal, inventory)

    proposal_record = {
        "applied_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "proposal": proposal,
    }
    proposals = list(inventory.get("rail_proposals") or [])
    if isinstance(inventory.get("rail_proposals"), dict):
        proposals = []
    inventory["rail_proposals"] = proposals
    inventory.setdefault("applied_proposals", [])
    inventory["applied_proposals"] = (inventory.get("applied_proposals") or [])[-19:] + [proposal_record]

    PROPOSALS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = proposal_record["applied_at"][:10]
    snippet_path = PROPOSALS_DIR / f"{stamp}-{proposal['rails'][0]['rail_id']}.yaml.snippet"
    snippet_path.write_text(
        "\n\n".join(
            build_rail_yaml_block(rail, existing_rails.get(rail["rail_id"]))
            for rail in proposal["rails"]
        ),
        encoding="utf-8",
    )

    write = args.write
    if args.auto_low_risk:
        if is_low_risk_proposal(proposal, yaml_path.read_text(encoding="utf-8")):
            write = True
            print("auto-low-risk: enriching existing rails only — applying")
        elif not write:
            print("auto-low-risk: new rails detected — dry-run (pass --write to force)")

    if not write:
        print("dry-run — pass --write to apply")
        print(f"would update: {yaml_path}")
        print(f"would update: {RAIL_INDEX_PATH}")
        print(f"would update: {inventory_path()}")
        print(f"snippet: {snippet_path}")
        return 0

    yaml_path.write_text(text, encoding="utf-8")
    RAIL_INDEX_PATH.write_text(json.dumps(index_data, indent=2) + "\n", encoding="utf-8")
    save_inventory(inventory, inventory_path())
    print(f"applied → {yaml_path}")
    print(f"index  → {RAIL_INDEX_PATH}")
    print(f"inventory → {inventory_path()}")
    print(f"snippet → {snippet_path}")
    print("next: bash scripts/m4-addons/mdblist-catalog-pipeline.sh check-import")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply LLM rail composition proposals")
    sub = parser.add_subparsers(dest="cmd", required=True)

    for name in ("validate", "plan", "apply"):
        p = sub.add_parser(name)
        p.add_argument("proposal", type=Path)
        if name == "apply":
            p.add_argument("--write", action="store_true", help="Write yaml + inventory (default dry-run)")
            p.add_argument(
                "--auto-low-risk",
                action="store_true",
                help="Auto --write when proposal only enriches existing rail ids",
            )
        p.set_defaults(func=globals()[f"cmd_{name}"])

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

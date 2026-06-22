#!/usr/bin/env python3
"""Build a mango-focused AIOMetadata config from a configure export JSON."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

CATALOG_ID_RE = re.compile(
    r"^(?:mdblist\.\d+|custom\.[a-z0-9_.]+)$",
    re.IGNORECASE,
)


def load_env_keys(env_path: Path) -> dict[str, str]:
    keys: dict[str, str] = {}
    if not env_path.is_file():
        return keys
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        keys[key.strip()] = value.strip()
    return keys


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def rail_catalog_index(repo: Path, catalog_yaml: Path) -> list[dict[str, str]]:
    """Catalog ids required for mango rails — from aiometadata-rail-catalogs.json or yaml."""
    index_path = repo / "config/aiometadata-rail-catalogs.json"
    if index_path.is_file():
        data = json.loads(index_path.read_text(encoding="utf-8"))
        out: list[dict[str, str]] = []
        for entry in data.get("catalogs") or []:
            cid = str(entry.get("id") or "")
            if not cid:
                continue
            for rail in entry.get("rails") or []:
                out.append({"rail": str(rail), "catalog": cid})
        if out:
            return out
    return rail_catalog_refs_yaml(catalog_yaml)


def rail_catalog_refs_yaml(catalog_yaml: Path) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    current_rail: str | None = None
    pending_aiometadata = False
    for line in catalog_yaml.read_text(encoding="utf-8").splitlines():
        if re.match(r"^\s*-\s*id:\s*", line):
            pending_aiometadata = False
            m = re.search(r"id:\s*(\S+)", line)
            current_rail = m.group(1) if m else None
            continue
        if not current_rail:
            continue
        if re.match(r"^\s*addon:\s*AIOMetadata\s*$", line):
            pending_aiometadata = True
            continue
        if pending_aiometadata:
            m = re.match(r"^\s*catalog:\s*(\S+)", line)
            if m and CATALOG_ID_RE.match(m.group(1)):
                refs.append({"rail": current_rail, "catalog": m.group(1)})
                pending_aiometadata = False
            continue
        if "addon: AIOMetadata" in line:
            for token in re.findall(r"catalog:\s*([^,}]+)", line):
                cid = token.strip()
                if CATALOG_ID_RE.match(cid):
                    refs.append({"rail": current_rail, "catalog": cid})
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, str]] = []
    for ref in refs:
        key = (ref["rail"], ref["catalog"])
        if key not in seen:
            seen.add(key)
            unique.append(ref)
    return unique


def needed_catalog_ids(refs: list[dict[str, str]]) -> set[str]:
    return {r["catalog"] for r in refs}


def load_mdblist_inventory(repo: Path) -> dict[str, Any]:
    path = repo / "config" / "mdblist-inventory.json"
    if not path.is_file():
        return {"catalogs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def inventory_by_catalog_id(inventory: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("catalog_id")): row
        for row in (inventory.get("catalogs") or [])
        if row.get("catalog_id")
    }


def mdblist_catalog_type(media: str | None) -> str:
    if media == "series":
        return "series"
    return "movie"


def synthesize_mdblist_catalog(row: dict[str, Any]) -> dict[str, Any]:
    catalog_id = str(row["catalog_id"])
    slug = str(row.get("slug") or "")
    author = slug.split("/", 1)[0] if slug else ""
    url = str(row.get("url") or f"https://mdblist.com/lists/{slug}")
    return {
        "id": catalog_id,
        "name": str(row.get("name") or catalog_id),
        "sort": "default",
        "type": mdblist_catalog_type(row.get("media")),
        "order": "asc",
        "source": "mdblist",
        "enabled": True,
        "cacheTTL": 86400,
        "metadata": {
            "url": url,
            "author": author,
            "itemCount": int(row.get("items") or 0),
        },
        "showInHome": False,
        "genreSelection": "standard",
        "randomizePerPage": True,
        "enableRatingPosters": True,
    }


def collect_rail_refs(repo: Path, catalog_yaml: Path) -> list[dict[str, str]]:
    refs = rail_catalog_refs_yaml(catalog_yaml)
    if refs:
        return refs
    return rail_catalog_index(repo, catalog_yaml)


def apply_self_host_api_keys(api: dict[str, Any], env_keys: dict[str, str]) -> None:
    if not str(api.get("tmdb") or "").strip():
        tmdb = env_keys.get("TMDB_API_KEY", "") or env_keys.get("BUILT_IN_TMDB_API_KEY", "")
        if tmdb.strip():
            api["tmdb"] = tmdb.strip()
    if not str(api.get("mdblist") or "").strip():
        mdblist = env_keys.get("MDBLIST_API_KEY", "")
        if mdblist.strip():
            api["mdblist"] = mdblist.strip()
    api["hasBuiltInTmdb"] = False
    api["hasBuiltInTvdb"] = False
    blurb = str(api.get("customDescriptionBlurb") or "")
    if "elfhosted.com" in blurb.lower():
        api["customDescriptionBlurb"] = ""


def select_catalogs_from_export(
    export_catalogs: list[dict[str, Any]],
    needed_ids: set[str],
    refs: list[dict[str, str]],
    inventory: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    by_id: dict[str, list[dict[str, Any]]] = {}
    for cat in export_catalogs:
        cid = str(cat.get("id") or "")
        if cid:
            by_id.setdefault(cid, []).append(cat)

    inv_index = inventory_by_catalog_id(inventory or {})
    selected: list[dict[str, Any]] = []
    warnings: list[str] = []
    synthesized: list[str] = []
    for catalog_id in sorted(needed_ids):
        matches = by_id.get(catalog_id, [])
        if not matches:
            inv_row = inv_index.get(catalog_id)
            if inv_row and catalog_id.startswith("mdblist."):
                matches = [synthesize_mdblist_catalog(inv_row)]
                synthesized.append(catalog_id)
            else:
                rails = [r["rail"] for r in refs if r["catalog"] == catalog_id]
                warnings.append(
                    f"missing in export: {catalog_id} (rails: {', '.join(rails)})"
                )
                continue
        for cat in matches:
            entry = json.loads(json.dumps(cat))
            entry["enabled"] = True
            entry["showInHome"] = False
            selected.append(entry)
    if synthesized:
        print(
            f"synthesized {len(synthesized)} mdblist catalogs from inventory: "
            + ", ".join(synthesized),
            file=sys.stderr,
        )
    return selected, warnings


def build_mango_config_with_extras(
    export_path: Path,
    catalog_yaml: Path,
    env_path: Path,
    extra_ids: set[str],
) -> tuple[dict[str, Any], list[str]]:
    repo = repo_root()
    refs = collect_rail_refs(repo, catalog_yaml)
    reserve_path = repo / "config/ai-catalog-reserve.json"
    reserve_ids: set[str] = set()
    if reserve_path.is_file():
        reserve_data = json.loads(reserve_path.read_text(encoding="utf-8"))
        for entry in reserve_data.get("catalogs") or []:
            cid = str(entry.get("id") or "")
            if cid:
                reserve_ids.add(cid)
    needed_ids = needed_catalog_ids(refs) | extra_ids | reserve_ids
    raw = json.loads(export_path.read_text(encoding="utf-8"))
    source = raw.get("config") or raw
    if not isinstance(source, dict):
        raise SystemExit("export missing config object")

    inventory = load_mdblist_inventory(repo)
    selected, warnings = select_catalogs_from_export(
        source.get("catalogs") or [],
        needed_ids,
        refs,
        inventory,
    )

    config: dict[str, Any] = {
        "language": source.get("language", "en-US"),
        "providers": source.get("providers") or {
            "movie": "tmdb",
            "series": "tvdb",
            "anime": "mal",
        },
        "artProviders": source.get("artProviders"),
        "apiKeys": json.loads(json.dumps(source.get("apiKeys") or {})),
        "search": {
            "enabled": False,
            "ai_enabled": False,
            "providers": (source.get("search") or {}).get("providers") or {},
            "engineEnabled": {},
        },
        "catalogs": selected,
        "sfw": source.get("sfw", False),
        "catalogSetupComplete": True,
        "mdblistWatchTracking": source.get("mdblistWatchTracking", False),
        "posterRatingProvider": source.get("posterRatingProvider", "rpdb"),
        "showDisabledCatalogs": False,
    }

    apply_self_host_api_keys(config["apiKeys"], load_env_keys(env_path))
    return config, warnings


def build_mango_config(
    export_path: Path,
    catalog_yaml: Path,
    env_path: Path,
) -> tuple[dict[str, Any], list[str]]:
    return build_mango_config_with_extras(export_path, catalog_yaml, env_path, set())


def check_export(
    export_path: Path,
    catalog_yaml: Path,
    manifest_path: Path | None = None,
) -> int:
    repo = repo_root()
    refs = collect_rail_refs(repo, catalog_yaml)
    needed_ids = needed_catalog_ids(refs)
    inventory = load_mdblist_inventory(repo)
    inv_index = inventory_by_catalog_id(inventory)
    raw = json.loads(export_path.read_text(encoding="utf-8"))
    source = raw.get("config") or raw
    export_ids = {str(c.get("id")) for c in (source.get("catalogs") or []) if c.get("id")}
    manifest_ids: set[str] = set()
    if manifest_path and manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest_ids = {str(c.get("id")) for c in (manifest.get("catalogs") or []) if c.get("id")}

    print(f"rails need {len(needed_ids)} AIOMetadata catalogs")
    for catalog_id in sorted(needed_ids):
        rails = [r["rail"] for r in refs if r["catalog"] == catalog_id]
        in_export = catalog_id in export_ids
        in_manifest = catalog_id in manifest_ids if manifest_ids else None
        status = []
        status.append("export" if in_export else "NO export")
        if in_manifest is not None:
            status.append("manifest" if in_manifest else "NO manifest")
        print(f"  {catalog_id:48} {' | '.join(status):20} ← {', '.join(rails)}")

    missing = needed_ids - export_ids
    synthesizable = {
        cid for cid in missing
        if cid.startswith("mdblist.") and cid in inv_index
    }
    still_missing = missing - synthesizable
    if synthesizable:
        print(f"\nOK: {len(synthesizable)} catalogs synthesizable from mdblist-inventory.json")
        for cid in sorted(synthesizable):
            print(f"  + {cid} (inventory)")
    if still_missing:
        print(f"\nWARN: {len(still_missing)} catalogs missing from export and inventory")
        return 1
    if missing and not still_missing:
        print("\nOK: export + inventory cover all mango rail catalogs")
        return 0
    if not missing:
        print("\nOK: export covers all mango rail catalogs")
    return 0 if not still_missing else 1


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(
            "usage: aiometadata_mango.py build|check|ensure <export.json> [catalog.yaml] [manifest.json|extra_ids...]"
        )

    cmd = sys.argv[1]
    export_path = Path(sys.argv[2])
    repo = repo_root()
    catalog_yaml = Path(sys.argv[3]) if len(sys.argv) > 3 else repo / "config/catalog.example.yaml"
    env_path = repo / "deploy/aiometadata/.env"

    if cmd == "build":
        config, warnings = build_mango_config(export_path, catalog_yaml, env_path)
        for w in warnings:
            print(f"WARN: {w}", file=sys.stderr)
        print(json.dumps(config))
        if warnings:
            raise SystemExit(2)
        return

    if cmd == "check":
        manifest = Path(sys.argv[4]) if len(sys.argv) > 4 else None
        raise SystemExit(check_export(export_path, catalog_yaml, manifest))

    if cmd == "ensure":
        extra_ids = {arg.strip() for arg in sys.argv[3:] if arg.strip()}
        config, warnings = build_mango_config_with_extras(
            export_path,
            catalog_yaml,
            env_path,
            extra_ids,
        )
        for w in warnings:
            print(f"WARN: {w}", file=sys.stderr)
        print(json.dumps(config))
        return

    raise SystemExit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main()

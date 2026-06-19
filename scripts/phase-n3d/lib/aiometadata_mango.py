#!/usr/bin/env python3
"""Build a mango-focused AIOMetadata config from a configure export JSON."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


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


def rail_catalog_refs(catalog_yaml: Path) -> list[dict[str, str]]:
    """Parse config/catalog.example.yaml for AIOMetadata mdblist sources."""
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
            m = re.match(r"^\s*catalog:\s*(mdblist\.\d+)", line)
            if m:
                refs.append({"rail": current_rail, "catalog": m.group(1)})
                pending_aiometadata = False
            continue
        if "addon: AIOMetadata" in line:
            for catalog_id in re.findall(r"mdblist\.\d+", line):
                refs.append({"rail": current_rail, "catalog": catalog_id})

    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, str]] = []
    for ref in refs:
        key = (ref["rail"], ref["catalog"])
        if key not in seen:
            seen.add(key)
            unique.append(ref)
    return unique


def required_catalog_keys(refs: list[dict[str, str]]) -> set[str]:
    return {r["catalog"] for r in refs}


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


def build_mango_config(
    export_path: Path,
    catalog_yaml: Path,
    env_path: Path,
) -> tuple[dict[str, Any], list[str]]:
    raw = json.loads(export_path.read_text(encoding="utf-8"))
    source = raw.get("config") or raw
    if not isinstance(source, dict):
        raise SystemExit("export missing config object")

    refs = rail_catalog_refs(catalog_yaml)
    needed_ids = {r["catalog"] for r in refs}

    export_catalogs = source.get("catalogs") or []
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for cat in export_catalogs:
        cid = str(cat.get("id") or "")
        ctype = str(cat.get("type") or "")
        if cid.startswith("mdblist."):
            by_key[(cid, ctype)] = cat

    selected: list[dict[str, Any]] = []
    warnings: list[str] = []
    for catalog_id in sorted(needed_ids):
        matches = [(k, v) for k, v in by_key.items() if k[0] == catalog_id]
        if not matches:
            rails = [r["rail"] for r in refs if r["catalog"] == catalog_id]
            warnings.append(
                f"missing in export: {catalog_id} (rails: {', '.join(rails)})"
            )
            continue
        for (_, _), cat in matches:
            entry = json.loads(json.dumps(cat))
            entry["enabled"] = True
            entry["showInHome"] = False
            selected.append(entry)

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


def check_export(
    export_path: Path,
    catalog_yaml: Path,
    manifest_path: Path | None = None,
) -> int:
    refs = rail_catalog_refs(catalog_yaml)
    needed_ids = {r["catalog"] for r in refs}
    raw = json.loads(export_path.read_text(encoding="utf-8"))
    source = raw.get("config") or raw
    export_ids = {
        str(c.get("id"))
        for c in (source.get("catalogs") or [])
        if str(c.get("id", "")).startswith("mdblist.")
    }
    manifest_ids: set[str] = set()
    if manifest_path and manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest_ids = {
            str(c.get("id"))
            for c in (manifest.get("catalogs") or [])
            if str(c.get("id", "")).startswith("mdblist.")
        }

    print(f"rails need {len(needed_ids)} mdblist catalogs")
    for catalog_id in sorted(needed_ids):
        rails = [r["rail"] for r in refs if r["catalog"] == catalog_id]
        in_export = catalog_id in export_ids
        in_manifest = catalog_id in manifest_ids if manifest_ids else None
        status = []
        status.append("export" if in_export else "NO export")
        if in_manifest is not None:
            status.append("manifest" if in_manifest else "NO manifest")
        print(f"  {catalog_id:20} {' | '.join(status):20} ← {', '.join(rails)}")

    missing = needed_ids - export_ids
    if missing:
        print(f"\nWARN: {len(missing)} catalogs missing from export")
        return 1
    print("\nOK: export covers all mango rail catalogs")
    return 0


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: aiometadata_mango.py build|check <export.json> [catalog.yaml] [env]")

    cmd = sys.argv[1]
    export_path = Path(sys.argv[2])
    repo = Path(__file__).resolve().parents[3]
    catalog_yaml = Path(sys.argv[3]) if len(sys.argv) > 3 else repo / "config/catalog.example.yaml"
    env_path = Path(sys.argv[4]) if len(sys.argv) > 4 else repo / "deploy/aiometadata/.env"

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

    raise SystemExit(f"unknown command: {cmd}")


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# N5d gate — AI catalog reserve coverage.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
RESERVE="$REPO_DIR/config/ai-catalog-reserve.json"
INVENTORY="$REPO_DIR/config/mdblist-inventory.json"

python3 - <<'PY' "$RESERVE" "$INVENTORY"
import json, sys
reserve = json.load(open(sys.argv[1], encoding="utf-8"))
inventory = json.load(open(sys.argv[2], encoding="utf-8"))
by_id = {c["catalog_id"]: c for c in inventory.get("catalogs") or []}
required = ["horror", "comedy", "documentary"]
tags_found = set()
for entry in reserve.get("catalogs") or []:
    cid = entry.get("id")
    if cid not in by_id:
        print(f"WARN: reserve id not in inventory: {cid}")
    for tag in entry.get("tags") or []:
        tags_found.add(tag)
missing = [g for g in required if g not in tags_found]
if missing:
    raise SystemExit(f"reserve missing genres: {missing}")
count = len(reserve.get("catalogs") or [])
if count < 10:
    raise SystemExit(f"reserve too small: {count}")
print(f"reserve gate ok: {count} catalogs")
PY

echo "N5d mdblist reserve gate ok"

#!/usr/bin/env bash
# List catalog ids from the configured AIOMetadata manifest (stremio-export).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
# shellcheck source=lib/aiometadata.sh
source "$REPO_DIR/scripts/m4-addons/lib/aiometadata.sh"

MANIFEST_URL="${1:-}"
if [[ -z "$MANIFEST_URL" ]]; then
  MANIFEST_URL="$(aiometadata_manifest_url)" || {
    echo "FAIL: AIOMetadata manifestUrl missing in $(aiometadata_export_file)" >&2
    exit 1
  }
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -sf --max-time 15 "$MANIFEST_URL" >"$TMP"

python3 - "$TMP" <<'PY'
import json, sys
from collections import defaultdict

data = json.load(open(sys.argv[1], encoding="utf-8"))
by_type = defaultdict(list)
for cat in data.get("catalogs", []):
    ctype = str(cat.get("type") or "?")
    cid = str(cat.get("id") or "")
    name = str(cat.get("name") or "")
    if cid:
        by_type[ctype].append((cid, name))

print(f"addon: {data.get('name', '')}")
print(f"id: {data.get('id', '')}")
print()
for ctype in sorted(by_type):
    print(f"[{ctype}]")
    for cid, name in sorted(by_type[ctype], key=lambda row: row[0]):
        label = f" — {name}" if name else ""
        print(f"  {cid}{label}")
    print()

mdblist = [cid for ctype in by_type for cid, _ in by_type[ctype] if cid.startswith("mdblist.")]
custom = [cid for ctype in by_type for cid, _ in by_type[ctype] if cid.startswith("custom.")]
if mdblist:
    print(f"mdblist catalogs: {len(mdblist)}")
if custom:
    print(f"custom catalogs: {len(custom)}")
if not mdblist and not custom:
    print("WARN: no mdblist/custom catalogs in manifest — run aiometadata-config.sh import")
PY

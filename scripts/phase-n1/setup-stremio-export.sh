#!/usr/bin/env bash
# Install / validate Stremio export for catalog-service.
#
# Stremio desktop: Settings → Export → save JSON file.
# Then on Pi:
#   bash scripts/phase-n1/setup-stremio-export.sh ~/Downloads/stremio-export.json
#
# Or auto-import from logged-in Stremio on this Pi:
#   bash scripts/phase-n1/setup-stremio-export.sh --from-local

set -euo pipefail

DEST="/etc/mango/stremio-export.json"
EXAMPLE="${MANGO_REPO_DIR:-$HOME/mango}/config/stremio-export.example.json"

usage() {
  cat <<EOF
usage:
  $0 <path-to-export.json>   # copy to $DEST
  $0 --from-local             # read addons from logged-in Stremio on this Pi
  $0 --check                 # validate existing $DEST
  $0 --help

Auto-import (Pi, Stremio already logged in):
  bash $0 --from-local

Manual export from Stremio desktop (secrets file only — not repo deploy; see docs/DEPLOY.md):
  1. Open Stremio → ⚙ Settings → Export
  2. Save the JSON file
  3. scp export.json mango:/tmp/stremio-export.json   # /etc/mango secret, not git
  4. bash $0 /tmp/stremio-export.json

Never commit the real export. Template: config/stremio-export.example.json
EOF
}

validate_json() {
  local path="$1"
  python3 - "$path" <<'PY'
import json, sys
path = sys.argv[1]
data = json.loads(open(path, encoding="utf-8").read())
addons = data.get("addons")
if isinstance(addons, dict) and isinstance(addons.get("addons"), list):
    addons = addons["addons"]
if not isinstance(addons, list) or not addons:
    raise SystemExit("FAIL: addons[] missing or empty")
names = []
for i, a in enumerate(addons):
    if not isinstance(a, dict):
        raise SystemExit(f"FAIL: addons[{i}] not an object")
    url = a.get("manifestUrl") or a.get("transportUrl") or a.get("url")
    if not url:
        raise SystemExit(f"FAIL: addons[{i}] missing manifestUrl")
    manifest = a.get("manifest") if isinstance(a.get("manifest"), dict) else {}
    names.append(a.get("name") or manifest.get("name") or url[:40])
print("OK:", len(addons), "addons —", ", ".join(names[:8]))
PY
}

install_export() {
  local src="$1"
  python3 - "$src" "$DEST" <<'PY'
import json, sys
src, dest = sys.argv[1], sys.argv[2]
data = json.loads(open(src, encoding="utf-8").read())
addons = data.get("addons")
if isinstance(addons, dict) and isinstance(addons.get("addons"), list):
    addons = addons["addons"]
if not isinstance(addons, list) or not addons:
    raise SystemExit("FAIL: addons[] missing or empty")
out = []
for a in addons:
    if not isinstance(a, dict):
        continue
    url = a.get("manifestUrl") or a.get("transportUrl") or a.get("url")
    if not url:
        continue
    manifest = a.get("manifest") if isinstance(a.get("manifest"), dict) else {}
    name = a.get("name") or manifest.get("name") or url.split("/")[2]
    out.append({"name": str(name), "manifestUrl": str(url)})
if not out:
    raise SystemExit("FAIL: no addons with manifest URLs")
export = {
    "addons": out,
    "auth": data.get("auth") if isinstance(data.get("auth"), dict) else {},
    "source": "stremio-settings-export",
}
open(dest, "w", encoding="utf-8").write(json.dumps(export, indent=2) + "\n")
import os
os.chmod(dest, 0o600)
print(f"✓ Normalized {len(out)} addons → {dest}")
for item in out:
    print(f"  - {item['name']}")
print("  (slim catalog export — library not copied; use full export for N4)")
PY
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --from-local)
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    python3 "${SCRIPT_DIR}/import-stremio-local.py" -o "$DEST"
    validate_json "$DEST"
    exit 0
    ;;
  --check)
    [[ -f "$DEST" ]] || { echo "FAIL: $DEST not found" >&2; exit 1; }
    validate_json "$DEST"
    exit 0
    ;;
  "")
    usage
    exit 2
    ;;
esac

SRC="$1"
[[ -f "$SRC" ]] || { echo "FAIL: not a file: $SRC" >&2; exit 1; }
validate_json "$SRC"
mkdir -p /etc/mango
install_export "$SRC"
validate_json "$DEST"

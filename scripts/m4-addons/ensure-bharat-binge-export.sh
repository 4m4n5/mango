#!/usr/bin/env bash
# Idempotently add Bharat Binge to /etc/mango/stremio-export.json (Hindi catalog pack).
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
EXPORT="${MANGO_STREMIO_EXPORT:-/etc/mango/stremio-export.json}"
MANIFEST_URL_FILE="$REPO_DIR/config/bharat-binge-manifest.url"

[[ -f "$EXPORT" ]] || {
  echo "ensure-bharat-binge: missing $EXPORT" >&2
  exit 1
}
[[ -f "$MANIFEST_URL_FILE" ]] || {
  echo "ensure-bharat-binge: missing $MANIFEST_URL_FILE" >&2
  exit 1
}

MANIFEST_URL="$(tr -d '[:space:]' <"$MANIFEST_URL_FILE")"
[[ -n "$MANIFEST_URL" ]] || {
  echo "ensure-bharat-binge: empty manifest url" >&2
  exit 1
}

python3 - "$EXPORT" "$MANIFEST_URL" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
manifest_url = sys.argv[2]
data = json.loads(path.read_text(encoding="utf-8"))
addons = data.setdefault("addons", [])
name = "Bharat Binge"
for addon in addons:
    if addon.get("name") == name:
        if addon.get("manifestUrl") == manifest_url:
            print("ensure-bharat-binge: already present")
            raise SystemExit(0)
        addon["manifestUrl"] = manifest_url
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print("ensure-bharat-binge: updated manifest url")
        raise SystemExit(0)

addons.append({"name": name, "manifestUrl": manifest_url})
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print("ensure-bharat-binge: added Bharat Binge")
PY

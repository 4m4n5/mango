#!/usr/bin/env bash
# Foreground catalog-service runner for systemd and stack scripts.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

if [[ "${MANGO_CATALOG:-1}" != "1" ]]; then
  echo "catalog-service disabled: MANGO_CATALOG=${MANGO_CATALOG:-0}" >&2
  exit 1
fi

if [[ ! -f src/catalog-service/dist/index.js ]]; then
  echo "catalog-service dist missing; run: cd src/catalog-service && npm ci && npm run build" >&2
  exit 1
fi

# shellcheck source=../../lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"

catalog_yaml="$(resolve_catalog_yaml)"
catalog_filters="$(resolve_catalog_filters)"

# Wait for self-hosted addon manifests to be reachable before loading the catalog.
# At boot the catalog service starts before the Docker containers (AIOStreams,
# AIOMetadata, live nexotv) finish initializing; if their manifest fetches fail
# the catalog caches a partial addon set and rails/streams come up empty until a
# manual restart. This polls each localhost manifest URL from the export file.
export_path="${MANGO_STREMIO_EXPORT:-/etc/mango/stremio-export.json}"
if [[ -f "$export_path" ]]; then
  mapfile -t local_manifests < <(python3 - "$export_path" <<'PY' 2>/dev/null || true
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
addons = data.get("addons") if isinstance(data, dict) else None
if not isinstance(addons, list):
    sys.exit(0)
for addon in addons:
    if not isinstance(addon, dict):
        continue
    url = addon.get("manifestUrl") or addon.get("manifest_url") or ""
    if isinstance(url, str) and ("127.0.0.1" in url or "localhost" in url):
        print(url)
PY
)
  if [[ ${#local_manifests[@]} -gt 0 ]]; then
    echo "catalog-service: waiting for ${#local_manifests[@]} local addon manifest(s)" >&2
    deadline=$(( $(date +%s) + 90 ))
    for url in "${local_manifests[@]}"; do
      while [[ $(date +%s) -lt $deadline ]]; do
        # Any HTTP response means the container is up. Live NexoTV often returns
        # 429 under probe storms; -f would treat that as "not ready" and burn the
        # full 90s boot budget before catalog listens.
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$url" 2>/dev/null || true)"
        if [[ "$code" =~ ^[1-5][0-9][0-9]$ ]]; then
          break
        fi
        sleep 2
      done
    done
    echo "catalog-service: local addon manifests reachable (or 90s timeout elapsed)" >&2
  fi
fi

cd "$REPO_DIR/src/catalog-service"
exec env \
  MANGO_REPO_DIR="$REPO_DIR" \
  MANGO_CATALOG_YAML="$catalog_yaml" \
  MANGO_CATALOG_FILTERS="$catalog_filters" \
  node dist/index.js

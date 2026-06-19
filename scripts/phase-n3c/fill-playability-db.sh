#!/usr/bin/env bash
# Systematic playability DB fill — preflight, sync catalog yaml, full maintenance.
#
# Run on Pi after stream plane is healthy (AIOStreams + AIOLists + catalog-service).
#
# Usage:
#   bash scripts/phase-n3c/fill-playability-db.sh
#
# Env:
#   MANGO_FILL_SKIP_CATALOG_SYNC=1   skip sudo cp catalog.example.yaml → /etc/mango/
#   MANGO_FILL_SKIP_MAINTENANCE=1    only preflight + status (dry run)

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

SKIP_SYNC="${MANGO_FILL_SKIP_CATALOG_SYNC:-0}"
SKIP_MAINT="${MANGO_FILL_SKIP_MAINTENANCE:-0}"

require_http() {
  local label="$1"
  local url="$2"
  curl -sf --max-time 8 "$url" >/dev/null \
    || { echo "FAIL: $label unreachable ($url)" >&2; exit 1; }
  echo "OK: $label"
}

echo "== mango fill playability db =="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

require_http "catalog-service" "http://127.0.0.1:3020/health"
require_http "AIOStreams" "http://127.0.0.1:3035/api/v1/status"
require_http "AIOLists" "http://127.0.0.1:3036/manifest.json"

if [[ "$SKIP_SYNC" != "1" ]]; then
  ETC="/etc/mango/catalog.yaml"
  EXAMPLE="$REPO_DIR/config/catalog.example.yaml"
  if [[ ! -f "$EXAMPLE" ]]; then
    echo "FAIL: missing $EXAMPLE" >&2
    exit 1
  fi
  if [[ -f "$ETC" ]] && cmp -s "$EXAMPLE" "$ETC"; then
    echo "OK: /etc/mango/catalog.yaml matches repo example"
  elif sudo -n cp "$EXAMPLE" "$ETC" 2>/dev/null; then
    echo "OK: catalog.yaml synced to /etc/mango/"
  else
    echo "WARN: could not sudo cp catalog.yaml — maintenance uses repo example when /etc differs" >&2
  fi
else
  echo "skip: catalog yaml sync (MANGO_FILL_SKIP_CATALOG_SYNC=1)"
fi

echo
echo "--- playability before ---"
python3 scripts/diag/playability-status.py 2>/dev/null || echo "(catalog must be up for status endpoint)"

if [[ "$SKIP_MAINT" == "1" ]]; then
  echo "skip: maintenance (MANGO_FILL_SKIP_MAINTENANCE=1)"
  exit 0
fi

echo
echo "starting full maintenance (stops UI + catalog, probes all rails)…"
bash scripts/phase-n3c/playability-maintenance.sh --mode full

echo
echo "--- playability after ---"
python3 scripts/diag/playability-status.py

echo
echo "optional: bash scripts/phase-n3d/gate-n3d-catalogs.sh"

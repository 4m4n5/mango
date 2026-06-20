#!/usr/bin/env bash
# Systematic playability DB fill — preflight, sync catalog yaml, bootstrap + pool top-up.
#
# Run on Pi after stream plane is healthy (AIOStreams + AIOMetadata + catalog-service).
#
# Usage:
#   bash scripts/phase-n3c/fill-playability-db.sh
#
# Env:
#   MANGO_FILL_SKIP_CATALOG_SYNC=1   skip sudo cp catalog.example.yaml → /etc/mango/
#   MANGO_FILL_SKIP_MAINTENANCE=1    only preflight + status (dry run)
#   MANGO_FILL_PURGE_POOLS=1         clear rail_pool + rail_session for all browse rails before fill
#   MANGO_FILL_POOL_TOPUP=1          second pass: full refresh to pool_target (default 1)
#
# Pass 1 (bootstrap): min_display per rail, re-probes recent failures.
# Pass 2 (pool top-up): full mode without bootstrap — fills to pool_target when > min_display.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

SKIP_SYNC="${MANGO_FILL_SKIP_CATALOG_SYNC:-0}"
SKIP_MAINT="${MANGO_FILL_SKIP_MAINTENANCE:-0}"
PURGE_POOLS="${MANGO_FILL_PURGE_POOLS:-0}"
POOL_TOPUP="${MANGO_FILL_POOL_TOPUP:-1}"

require_http() {
  local label="$1"
  local url="$2"
  curl -sf --max-time 8 "$url" >/dev/null \
    || { echo "FAIL: $label unreachable ($url)" >&2; exit 1; }
  echo "OK: $label"
}

purge_browse_rail_pools() {
  local catalog_yaml="${MANGO_CATALOG_YAML:-$REPO_DIR/config/catalog.example.yaml}"
  python3 - "$catalog_yaml" <<'PY'
import sqlite3
import sys
from pathlib import Path

import yaml

catalog_path = Path(sys.argv[1])
data = yaml.safe_load(catalog_path.read_text(encoding="utf-8"))
rail_ids = [
    rail["id"]
    for rail in data.get("rails") or []
    if rail.get("enabled", True) is not False
    and rail.get("type") in ("addon_catalog", "composite_list")
]
if not rail_ids:
    raise SystemExit("no browse rails to purge")

db = sqlite3.connect("/etc/mango/playability.db")
for rail_id in rail_ids:
    db.execute("DELETE FROM rail_pool WHERE rail_id = ?", (rail_id,))
    db.execute("DELETE FROM rail_session WHERE rail_id = ?", (rail_id,))
db.commit()
print(f"purged pools + sessions for {len(rail_ids)} rails")
PY
}

echo "== mango fill playability db =="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

# shellcheck source=../phase-n3d/lib/aiometadata.sh
source "$REPO_DIR/scripts/phase-n3d/lib/aiometadata.sh"

require_http "catalog-service" "http://127.0.0.1:3020/health"
require_http "AIOStreams" "http://127.0.0.1:3035/api/v1/status"
aiometadata_health_ok && echo "OK: AIOMetadata" || { echo "FAIL: AIOMetadata unreachable ($(aiometadata_health_url))" >&2; exit 1; }
aiometadata_manifest_ok && echo "OK: AIOMetadata manifest" || { echo "FAIL: AIOMetadata manifest unreachable (stremio-export)" >&2; exit 1; }

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

if [[ "$PURGE_POOLS" == "1" ]]; then
  echo
  echo "purging browse rail pools (MANGO_FILL_PURGE_POOLS=1)…"
  purge_browse_rail_pools
fi

echo
echo "pass 1: bootstrap maintenance (min_display targets)…"
rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/mango/playability-maintenance.lock"
export MANGO_PLAYABILITY_BOOTSTRAP=1
export MANGO_PLAYABILITY_CANDIDATE_LIMIT="${MANGO_FILL_CANDIDATE_LIMIT:-250}"
bash scripts/phase-n3c/playability-maintenance.sh --mode full --bootstrap

if [[ "$POOL_TOPUP" == "1" ]]; then
  echo
  echo "pass 2: pool top-up (pool_target, no early exit)…"
  rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/mango/playability-maintenance.lock"
  export MANGO_PLAYABILITY_BOOTSTRAP=0
  export MANGO_PLAYABILITY_EARLY_EXIT_MIN_DISPLAY=0
  export MANGO_PLAYABILITY_CANDIDATE_LIMIT="${MANGO_FILL_CANDIDATE_LIMIT:-250}"
  bash scripts/phase-n3c/playability-maintenance.sh --mode full
fi

echo
echo "--- playability after ---"
python3 scripts/diag/playability-status.py

echo
echo "--- series episode queue (S1E2+) ---"
python3 scripts/diag/episode-queue-status.py 2>/dev/null || true

echo
echo "optional: MANGO_RAIL_HITRATE_PER_RAIL=2 python3 scripts/diag/rail-hitrate.py"
echo "optional: bash scripts/phase-n3d/gate-n3d-catalogs.sh"

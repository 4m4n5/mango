#!/usr/bin/env bash
# Targeted playability top-up for one rail (maintenance window — stops catalog briefly).
#
# Usage:
#   bash scripts/phase-n3c/playability-top-up-rail.sh movies-india-trending [--pool-target 20]

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

RAIL_ID="${1:-}"
shift || true
POOL_TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pool-target) POOL_TARGET="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$RAIL_ID" ]] || { echo "usage: $0 <rail-id> [--pool-target N]" >&2; exit 2; }

# shellcheck source=../lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"
FILTERS_JSON="$(resolve_catalog_filters)"
export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-$(
  python3 - "$FILTERS_JSON" <<'PY'
import json
import sys
print(int(json.load(open(sys.argv[1], encoding="utf-8")).get("auto_play_probe_ms") or 8000))
PY
)}"
export MANGO_PLAYABILITY_PROBE_POOL=1
export MANGO_MAINTENANCE_MODE=1
export MANGO_PLAYABILITY_BOOTSTRAP=1

echo "top-up rail=$RAIL_ID probe_ms=$MANGO_PLAYABILITY_PROBE_MS"

if pgrep -f 'chromium.*127.0.0.1:3000' >/dev/null 2>&1; then
  pkill -f 'chromium.*127.0.0.1:3000' 2>/dev/null || true
  sleep 1
fi

if curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
  pid_file="${HOME}/.cache/mango/catalog-service.pid"
  [[ -f "$pid_file" ]] && kill "$(cat "$pid_file")" 2>/dev/null || true
  pkill -f '[c]atalog-service/dist/index.js' 2>/dev/null || true
  sleep 1
fi

ARGS=(top-up --rail "$RAIL_ID" --bootstrap)
[[ -n "$POOL_TARGET" ]] && ARGS+=(--pool-target "$POOL_TARGET")

npm --prefix src/catalog-service exec tsx -- scripts/phase-n3c/playability-indexer.ts "${ARGS[@]}"

MANGO_CATALOG=1 bash scripts/mango-refresh.sh >/dev/null
echo "top-up complete: $RAIL_ID"

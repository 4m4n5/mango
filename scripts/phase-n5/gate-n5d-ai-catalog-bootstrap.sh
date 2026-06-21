#!/usr/bin/env bash
# N5d gate — AI catalog compose + bootstrap contract.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CATALOG_DIR="$REPO_DIR/src/catalog-service"
CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"

cd "$CATALOG_DIR"
npm run build >/dev/null
node --test dist/ai-catalogs/compose.test.js

RESERVE="$REPO_DIR/config/ai-catalog-reserve.json"
if [[ ! -f "$RESERVE" ]]; then
  echo "missing ai catalog reserve: $RESERVE" >&2
  exit 1
fi
python3 - <<'PY' "$RESERVE"
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
catalogs = data.get("catalogs") or []
if len(catalogs) < 10:
    raise SystemExit(f"reserve too small: {len(catalogs)}")
horror = [c for c in catalogs if "horror" in (c.get("tags") or [])]
if not horror:
    raise SystemExit("reserve missing horror entry")
print(f"reserve ok: {len(catalogs)} catalogs, horror={horror[0]['id']}")
PY

if [[ "${MANGO_AI_CATALOG_BOOTSTRAP_E2E:-0}" == "1" ]]; then
  if ! curl -sf --max-time 5 "$CATALOG/health" >/dev/null; then
    echo "catalog down — skip bootstrap e2e" >&2
    exit 1
  fi
  SLOT="gate-horror-$$"
  CREATE="$(curl -sf --max-time 30 -X POST "$CATALOG/voice/ai-catalogs" \
    -H 'Content-Type: application/json' \
    -d "{\"label\":\"Gate Horror\",\"tab\":\"movies\",\"content_type\":\"movie\",\"theme\":\"horror movies\"}")"
  echo "$CREATE" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True; assert "bootstrap" in d'
  SLOT_ID="$(echo "$CREATE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["catalog"]["slot_id"])')"
  for _ in $(seq 1 40); do
    STATUS="$(curl -sf --max-time 10 "$CATALOG/voice/ai-catalogs/status?slot_id=$SLOT_ID" || true)"
    if echo "$STATUS" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("status") or {}; import sys as _s; _s.exit(0 if s.get("visible_on_tab") else 1)' 2>/dev/null; then
      echo "bootstrap e2e visible: $SLOT_ID"
      curl -sf --max-time 15 -X POST "$CATALOG/voice/ai-catalogs/delete" \
        -H 'Content-Type: application/json' \
        -d "{\"slot_id\":\"$SLOT_ID\"}" >/dev/null || true
      break
    fi
    sleep 3
  done
fi

echo "N5d ai-catalog bootstrap gate ok"

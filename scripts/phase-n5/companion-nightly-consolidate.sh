#!/usr/bin/env bash
# Nightly companion consolidate — recompile notes + journal rollup stub.
# Cron on Pi: 0 3 * * * cd ~/mango && bash scripts/phase-n5/companion-nightly-consolidate.sh
set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"

bash "$REPO_DIR/scripts/phase-n5/sync-companion-example.sh" || true

RESULT="$(curl -sf --max-time 30 -X POST "$CATALOG/voice/companion/consolidate" \
  -H 'content-type: application/json' \
  -d '{}' || true)"

if [[ -n "$RESULT" ]] && echo "$RESULT" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") is True' 2>/dev/null; then
  echo "PASS: companion nightly consolidate"
  echo "$RESULT"
  exit 0
fi

echo "FAIL: companion consolidate — is catalog-service up on $CATALOG?" >&2
echo "$RESULT" >&2
exit 1

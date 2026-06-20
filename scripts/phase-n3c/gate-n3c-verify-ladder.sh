#!/usr/bin/env bash
# Phase N3c gate — verify DB uses play ladder.

set -euo pipefail

export MANGO_REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init

REPO_DIR="$MANGO_REPO_DIR"
CATALOG_DIR="$REPO_DIR/src/catalog-service"

gate_header "mango N3c verify-ladder gate"

[[ -d "$CATALOG_DIR" ]] || { gate_fail "catalog-service missing"; exit 1; }

grep -q "probeWithLadder" "$CATALOG_DIR/src/playability/verify.ts" \
  && gate_pass "verify imports probeWithLadder" || gate_fail "verify imports probeWithLadder"

grep -q "win_ladder_step" "$CATALOG_DIR/src/playability/db.ts" \
  && gate_pass "db stores win_ladder_step" || gate_fail "db stores win_ladder_step"

bash "$REPO_DIR/scripts/lib/gate-play-ladder-core.sh" --strict \
  && gate_pass "play_ladder + catalog unit" || gate_fail "play_ladder + catalog unit"

if curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null 2>&1; then
  STATUS="$(curl -sf http://127.0.0.1:3020/playability/status)"
  python3 - "$STATUS" <<'PY' \
    && gate_pass "playability schema_version >= 2" || gate_warn "playability schema_version < 2 (restart catalog-service)"
import json
import sys
data = json.loads(sys.argv[1])
version = int(data.get("schema_version") or 0)
if version < 2:
    raise SystemExit(1)
print(f"schema_version={version}")
PY
else
  gate_warn "catalog down — skip live schema_version check"
fi

gate_finish "N3c verify-ladder gate" || exit 1

#!/usr/bin/env bash
# Phase N1 smoke gate — catalog-service API (spikes optional via MANGO_GATE_SPIKES=1).

set -euo pipefail

# shellcheck source=../../lib/gate-common.sh
source "$(cd "$(dirname "$0")/../.." && pwd)/lib/gate-common.sh"
mango_gate_init
gate_header "mango N1 smoke gate"

SMOKE_ID="${MANGO_SMOKE_TITLE_ID:-tt0111161}"

bash scripts/m2-catalog/service/check-m2-prereqs.sh >/dev/null && gate_pass "prereqs" || gate_fail "prereqs"

if [[ "${MANGO_GATE_SPIKES:-0}" == "1" ]]; then
  bash scripts/m2-catalog/service/spike-mpv-http.sh >/dev/null && gate_pass "spike-mpv-http" || gate_fail "spike-mpv-http"
  bash scripts/m2-catalog/service/spike-stremio-core.sh >/dev/null && gate_pass "spike-stremio-core" || gate_fail "spike-stremio-core"
fi

if curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null; then
  gate_pass "GET /health"
  curl -sf --max-time 30 "http://127.0.0.1:3020/meta/movie/${SMOKE_ID}" >/dev/null \
    && gate_pass "GET /meta" || gate_fail "GET /meta"
  curl -sf --max-time 60 "http://127.0.0.1:3020/stream/movie/${SMOKE_ID}" >/dev/null \
    && gate_pass "GET /stream" || gate_fail "GET /stream"
  OUT="/tmp/mango-n1-play.json"
  gate_post_play "shawshank" "movie" "$SMOKE_ID" "$OUT"
  gate_mpv_stop
else
  gate_fail "catalog-service :3020 down"
fi

pgrep -xc mpv 2>/dev/null | grep -qx 0 && gate_pass "mpv stopped" || gate_fail "mpv still running"

gate_finish "N1 gate" || exit 1

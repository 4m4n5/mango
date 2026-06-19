#!/usr/bin/env bash
# Phase N0 gate — stack hygiene, launcher health, optional voice checks.

set -euo pipefail

# shellcheck source=../lib/gate-common.sh
source "$(cd "$(dirname "$0")/.." && pwd)/lib/gate-common.sh"
mango_gate_init
gate_header "mango N0 gate"

gate_idle_hygiene

if ss -tlnp 2>/dev/null | grep -q '127.0.0.1:8766'; then
  gate_pass "loopback :8766"
elif [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  gate_fail "loopback :8766 missing with voice enabled"
fi

curl -sf --max-time 3 http://127.0.0.1:3000/api/health >/dev/null \
  && gate_pass "launcher /api/health" || gate_fail "launcher /api/health"
bash scripts/verify-tv.sh --quiet && gate_pass "verify-tv" || gate_fail "verify-tv"

if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  curl -skf --max-time 3 https://127.0.0.1:8765/health >/dev/null \
    && gate_pass "orchestrator /health" || gate_fail "orchestrator /health"
  if [[ "${MANGO_GATE_WS_STRESS:-0}" == "1" ]]; then
    python3 scripts/phase-n0/ws-stress.py --url wss://127.0.0.1:8765/ws --count 10 --insecure \
      && gate_pass "ws stress" || gate_fail "ws stress"
  fi
else
  gate_pass "voice disabled"
fi

if [[ "${MANGO_GATE_SCREENSHOT:-0}" == "1" ]]; then
  if SHOT="$(bash scripts/phase-n0/capture-tv.sh launcher-idle 2>/dev/null)"; then
    gate_pass "screenshot $SHOT"
  else
    gate_warn "screenshot skipped"
  fi
fi

gate_finish "N0 GATE" || exit 1

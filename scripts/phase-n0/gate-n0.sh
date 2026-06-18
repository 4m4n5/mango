#!/usr/bin/env bash
# Master Phase N0 gate. Run on the Pi after git pull + mango-stack restart.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi
export MANGO_SKIP_OVERLAY=1

ERRORS=0
WARNS=0

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }
warn() { echo "WARN: $*" >&2; WARNS=$((WARNS + 1)); }

echo "========== mango N0 gate $(date -Iseconds) =========="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

echo "--- baseline ---"
METRICS_PATH="$(bash scripts/diag/baseline-metrics.sh --label after-n0 --path-only)"
echo "metrics: $METRICS_PATH"
eval "$(python3 - "$METRICS_PATH" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
counts = data.get("process_counts", {})
memory = data.get("memory", {})
for key, value in counts.items():
    print(f"{key.upper()}={int(value)}")
print(f"MEM_AVAILABLE_MB={int(memory.get('mem_available_mb') or 0)}")
PY
)"

[[ "${CHROMIUM_PROCESS_COUNT:-99}" -le 1 ]] && pass "chromium app count ${CHROMIUM_PROCESS_COUNT}" || fail "chromium app count ${CHROMIUM_PROCESS_COUNT} > 1"
[[ "${OVERLAY_CHROMIUM:-99}" -eq 0 ]] && pass "overlay chromium absent" || fail "overlay chromium count ${OVERLAY_CHROMIUM}"
[[ "${STREMIO_PROCESS_COUNT:-99}" -eq 0 ]] && pass "stremio idle count 0" || fail "stremio idle count ${STREMIO_PROCESS_COUNT}"
[[ "${KODI_PROCESS_COUNT:-99}" -eq 0 ]] && pass "kodi idle count 0" || fail "kodi idle count ${KODI_PROCESS_COUNT}"
if [[ "${MEM_AVAILABLE_MB:-0}" -ge 3500 ]]; then
  pass "available memory ${MEM_AVAILABLE_MB} MB"
elif [[ "${MEM_AVAILABLE_MB:-0}" -ge 2500 ]]; then
  warn "available memory ${MEM_AVAILABLE_MB} MB < 3500 MB target"
else
  fail "available memory ${MEM_AVAILABLE_MB} MB < 2500 MB floor"
fi

echo "--- listeners ---"
if ss -tlnp 2>/dev/null | grep -q ':8766'; then
  fail "legacy :8766 listener still active"
else
  pass "no legacy :8766 listener"
fi

echo "--- launcher ---"
curl -sf --max-time 3 http://127.0.0.1:3000/api/health >/tmp/mango-n0-launcher-health.json \
  && pass "launcher /api/health" || fail "launcher /api/health"
bash scripts/verify-tv.sh --quiet && pass "verify-tv.sh" || fail "verify-tv.sh"

echo "--- voice ---"
if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  curl -skf --max-time 3 https://127.0.0.1:8765/health >/tmp/mango-n0-orchestrator-health.json \
    && pass "orchestrator https /health" || fail "orchestrator https /health"
  bash scripts/phase2/verify-voice-ready.sh && pass "verify-voice-ready.sh" || fail "verify-voice-ready.sh"
  python3 scripts/phase-n0/ws-stress.py --url wss://127.0.0.1:8765/ws --count 20 --insecure \
    && pass "ws stress" || fail "ws stress"
  if [[ -f "${HOME}/.cache/mango/orchestrator.log" ]]; then
    if tail -100 "${HOME}/.cache/mango/orchestrator.log" | grep -qi 'not connected'; then
      fail "orchestrator log contains 'not connected'"
    else
      pass "orchestrator log has no recent not-connected trace"
    fi
  else
    warn "orchestrator log missing"
  fi
else
  pass "voice disabled; skipped voice gate"
fi

echo "--- screenshots ---"
if SHOT="$(bash scripts/phase-n0/capture-tv.sh launcher-idle 2>/tmp/mango-n0-capture.err)"; then
  pass "screenshot $SHOT"
else
  warn "screenshot skipped: $(cat /tmp/mango-n0-capture.err)"
fi

echo
if (( ERRORS > 0 )); then
  echo "N0 GATE FAIL: $ERRORS error(s), $WARNS warning(s)"
  exit 1
fi
echo "N0 GATE PASS: $WARNS warning(s)"

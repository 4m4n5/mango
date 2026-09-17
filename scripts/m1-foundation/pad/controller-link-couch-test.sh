#!/usr/bin/env bash
# Interactive reconnect timing probe. It never pairs, unpairs, or restarts Mango.

set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
STATUS_FILE="$CACHE_DIR/mango-controller-link-status.json"
TIMEOUT_SEC="${MANGO_CONTROLLER_TEST_TIMEOUT_SEC:-20}"
CYCLES="${MANGO_CONTROLLER_TEST_CYCLES:-5}"

[[ -s "$STATUS_FILE" ]] || { echo "controller link status missing" >&2; exit 1; }
[[ "$CYCLES" =~ ^[1-9][0-9]*$ ]] || { echo "invalid cycle count: $CYCLES" >&2; exit 2; }
[[ "$TIMEOUT_SEC" =~ ^[1-9][0-9]*$ ]] || { echo "invalid timeout: $TIMEOUT_SEC" >&2; exit 2; }

read_state() {
  python3 - "$STATUS_FILE" "${1:-0}" <<'PY'
import json, math, sys, time
try:
    with open(sys.argv[1], encoding="utf-8") as source:
        data = json.load(source)
    updated = float(data.get("updated_at", 0))
    age = time.time() - updated
    fresh = math.isfinite(updated) and 0 <= age <= 5 and updated >= float(sys.argv[2])
    if not fresh:
        state = "stale"
    elif data.get("paired") is False:
        state = "needs_re-pair"
    elif data.get("connected") is False and data.get("input_ready") is False:
        state = "off"
    elif data.get("state") == "ready" and data.get("connected") is True and data.get("input_ready") is True:
        state = "ready"
    else:
        state = "waiting"
except (OSError, ValueError, TypeError):
    state = "missing"
print(state)
PY
}

policy="$(python3 - "$STATUS_FILE" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    data = {}
print(data.get("pairing_policy", "missing"))
PY
)"
[[ "$policy" == "explicit_recovery_only" ]] || {
  echo "FAIL controller supervisor does not expose the no-pairing policy" >&2
  exit 1
}

echo "Normal-wake couch proof: ${CYCLES} cycles, zero pairing-mode entries."
for cycle in $(seq 1 "$CYCLES"); do
  echo "Cycle ${cycle}/${CYCLES}: turn the Micro off for at least 30 seconds, then press ENTER."
  read -r _
  [[ "$(read_state)" == "off" ]] || {
    echo "FAIL cycle ${cycle}: fresh disconnected/input-not-ready evidence required before wake" >&2
    exit 1
  }
  echo "Turn the Micro on with a normal power press only. Do not enter pairing mode."
  started="$(date +%s%3N)"
  armed_at="$(date +%s.%N)"
  deadline=$(( $(date +%s) + TIMEOUT_SEC ))
  while (( $(date +%s) <= deadline )); do
    state="$(read_state "$armed_at")"
    if [[ "$state" == "needs_re-pair" ]]; then
      echo "FAIL cycle ${cycle}: pairing record is reported missing; capture diagnostics before pairing" >&2
      exit 1
    fi
    if [[ "$state" == "ready" ]]; then
      finished="$(date +%s%3N)"
      echo "PASS cycle ${cycle}: fresh link and input ready; prompt-to-ready $((finished - started))ms (includes human reaction time; not button-to-ready latency)"
      break
    fi
    sleep 0.1
  done
  if [[ "$state" != "ready" ]]; then
    echo "FAIL cycle ${cycle}: controller did not become ready within ${TIMEOUT_SEC}s" >&2
    exit 1
  fi
done
echo "PASS ${CYCLES}/${CYCLES} normal-wake cycles with zero pairing-mode entries"

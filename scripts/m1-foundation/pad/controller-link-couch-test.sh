#!/usr/bin/env bash
# Interactive reconnect timing probe. It never pairs, unpairs, or restarts Mango.

set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
STATUS_FILE="$CACHE_DIR/mango-controller-link-status.json"
TIMEOUT_SEC="${MANGO_CONTROLLER_TEST_TIMEOUT_SEC:-20}"
CYCLES="${MANGO_CONTROLLER_TEST_CYCLES:-5}"

[[ -s "$STATUS_FILE" ]] || { echo "controller link status missing" >&2; exit 1; }
[[ "$CYCLES" =~ ^[1-9][0-9]*$ ]] || { echo "invalid cycle count: $CYCLES" >&2; exit 2; }

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
  echo "Turn the Micro on with a normal power press only. Do not enter pairing mode."
  started="$(date +%s%3N)"
  deadline=$(( $(date +%s) + TIMEOUT_SEC ))
  while (( $(date +%s) <= deadline )); do
    state="$(python3 - "$STATUS_FILE" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    data = {}
print(data.get("state", "missing"))
PY
)"
    if [[ "$state" == "needs_re-pair" ]]; then
      echo "FAIL cycle ${cycle}: pairing record is reported missing; capture diagnostics before pairing" >&2
      exit 1
    fi
    if [[ "$state" == "ready" ]]; then
      finished="$(date +%s%3N)"
      echo "PASS cycle ${cycle}: controller ready in $((finished - started))ms"
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

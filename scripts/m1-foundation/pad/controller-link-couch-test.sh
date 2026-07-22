#!/usr/bin/env bash
# Interactive reconnect timing probe. It never pairs, unpairs, or restarts Mango.

set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
STATUS_FILE="$CACHE_DIR/mango-controller-link-status.json"
TIMEOUT_SEC="${MANGO_CONTROLLER_TEST_TIMEOUT_SEC:-20}"

[[ -s "$STATUS_FILE" ]] || { echo "controller link status missing" >&2; exit 1; }
echo "Turn the Micro off now, then press ENTER. Do not enter pairing mode."
read -r _
echo "Turn the Micro on normally now. Measuring for up to ${TIMEOUT_SEC}s..."
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
  if [[ "$state" == "ready" ]]; then
    finished="$(date +%s%3N)"
    echo "PASS controller ready in $((finished - started))ms"
    exit 0
  fi
  sleep 0.1
done
echo "FAIL controller did not become ready within ${TIMEOUT_SEC}s" >&2
exit 1

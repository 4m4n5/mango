#!/usr/bin/env bash
# End-to-end: enqueue open_detail → launcher Chromium polls → POST /api/voice/ack.
# Run on Pi (or via pi-exec.sh). Requires mango-launcher Chromium kiosk up.
#
# Usage: bash scripts/phase-n5/validate-voice-tv-open.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

LAUNCHER_PORT="${MANGO_LAUNCHER_PORT:-3000}"
BASE="http://127.0.0.1:${LAUNCHER_PORT}"
TITLE_ID="${MANGO_VOICE_TEST_ID:-tt12004706}"
TITLE_NAME="${MANGO_VOICE_TEST_TITLE:-Panchayat}"
WAIT_SEC="${MANGO_VOICE_ACK_WAIT_SEC:-12}"

if ! curl -sf --max-time 3 "${BASE}/api/health" >/dev/null; then
  echo "FAIL: launcher /api/health down"
  exit 1
fi

if ! pgrep -f "chromium.*mango-launcher.*127.0.0.1:${LAUNCHER_PORT}/" >/dev/null; then
  echo "FAIL: mango-launcher Chromium not running"
  exit 1
fi

POST_JSON="$(curl -sf --max-time 5 -X POST "${BASE}/api/voice/command" \
  -H 'content-type: application/json' \
  -d "{\"type\":\"launcher_command\",\"action\":\"open_detail\",\"content_type\":\"series\",\"id\":\"${TITLE_ID}\",\"title\":\"${TITLE_NAME}\",\"tab\":\"series\"}")"

SEQ="$(echo "$POST_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("seq",0))')"
if [[ -z "$SEQ" || "$SEQ" == "0" ]]; then
  echo "FAIL: voice command enqueue returned no seq: $POST_JSON"
  exit 1
fi

echo "enqueued open_detail seq=${SEQ} — waiting for launcher ack (max ${WAIT_SEC}s)…"

deadline=$((SECONDS + WAIT_SEC))
while (( SECONDS < deadline )); do
  ACK_JSON="$(curl -sf --max-time 3 "${BASE}/api/voice/ack" || echo '{}')"
  if echo "$ACK_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('seq')==${SEQ} and d.get('ok') is True and d.get('action')=='open_detail' else 1)" 2>/dev/null; then
    echo "PASS: launcher ack seq=${SEQ} action=open_detail"
    exit 0
  fi
  sleep 0.25
done

ACK_JSON="$(curl -sf --max-time 3 "${BASE}/api/voice/ack" || echo '{}')"
echo "FAIL: no launcher ack for seq=${SEQ} within ${WAIT_SEC}s (last ack: ${ACK_JSON})"
exit 1

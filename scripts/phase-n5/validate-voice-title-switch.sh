#!/usr/bin/env bash
# Voice navigation: open title A → open title B without manual home/back.
# Run on Pi (or via pi-exec.sh). Requires mango-launcher Chromium kiosk up.
#
# Usage: bash scripts/phase-n5/validate-voice-title-switch.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

LAUNCHER_PORT="${MANGO_LAUNCHER_PORT:-3000}"
CATALOG="${MANGO_CATALOG_UPSTREAM:-http://127.0.0.1:3020}"
BASE="http://127.0.0.1:${LAUNCHER_PORT}"
WAIT_SEC="${MANGO_VOICE_ACK_WAIT_SEC:-12}"
QUERY_A="${MANGO_VOICE_SWITCH_QUERY_A:-Shawshank}"
QUERY_B="${MANGO_VOICE_SWITCH_QUERY_B:-Godfather}"

if ! curl -sf --max-time 3 "${BASE}/api/health" >/dev/null; then
  echo "FAIL: launcher /api/health down"
  exit 1
fi

if ! pgrep -f "chromium.*mango-launcher.*127.0.0.1:${LAUNCHER_PORT}/" >/dev/null; then
  echo "FAIL: mango-launcher Chromium not running"
  exit 1
fi

resolve_hit() {
  local query="$1"
  local json
  json="$(curl -sf --max-time 10 "${CATALOG}/voice/search?q=${query// /%20}&limit=3")"
  python3 -c 'import json,sys; d=json.load(sys.stdin); hits=d.get("results") or []; assert hits, "no hits"; h=hits[0]; print(h["type"], h["id"], h["title"], h.get("tab") or "movies")' <<<"$json"
}

read -r TYPE_A ID_A TITLE_A TAB_A < <(resolve_hit "$QUERY_A")
read -r TYPE_B ID_B TITLE_B TAB_B < <(resolve_hit "$QUERY_B")

if [[ "$ID_A" == "$ID_B" ]]; then
  echo "FAIL: switch test needs two distinct titles (both resolved to ${ID_A})"
  exit 1
fi

wait_ack() {
  local seq="$1"
  local action="$2"
  local deadline=$((SECONDS + WAIT_SEC))
  while (( SECONDS < deadline )); do
    local ack_json
    ack_json="$(curl -sf --max-time 3 "${BASE}/api/voice/ack" || echo '{}')"
    if echo "$ack_json" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('seq')==${seq} and d.get('ok') is True and d.get('action')=='${action}' else 1)" 2>/dev/null; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

open_title() {
  local type="$1"
  local id="$2"
  local title="$3"
  local tab="$4"
  local post_json seq
  post_json="$(curl -sf --max-time 5 -X POST "${BASE}/api/voice/command" \
    -H 'content-type: application/json' \
    -d "{\"type\":\"launcher_command\",\"action\":\"open_detail\",\"content_type\":\"${type}\",\"id\":\"${id}\",\"title\":\"${title}\",\"tab\":\"${tab}\"}")"
  seq="$(echo "$post_json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("seq",0))')"
  if [[ -z "$seq" || "$seq" == "0" ]]; then
    echo "FAIL: enqueue open_detail returned no seq: $post_json"
    exit 1
  fi
  echo "enqueued open_detail seq=${seq} title=${title}"
  if ! wait_ack "$seq" "open_detail"; then
    echo "FAIL: no ack for seq=${seq} title=${title}"
    exit 1
  fi
  echo "PASS: ack seq=${seq} title=${title}"
}

echo "=== voice title switch: ${TITLE_A} → ${TITLE_B} ==="
open_title "$TYPE_A" "$ID_A" "$TITLE_A" "$TAB_A"
sleep 0.5
open_title "$TYPE_B" "$ID_B" "$TITLE_B" "$TAB_B"
echo "PASS: switched titles without manual home/back"

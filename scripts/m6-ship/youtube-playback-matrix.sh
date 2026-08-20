#!/usr/bin/env bash
# Production play-session YouTube route matrix. Records privacy-safe evidence
# only: SHAs, timings, classified outcomes. Never prints URLs or titles.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
STOP="${MANGO_YOUTUBE_MATRIX_STOP:-1}"

curl_json() {
  curl -sf --max-time "${2:-20}" "$CATALOG$1"
}

post_json() {
  curl -sf --max-time "${3:-20}" \
    -H 'content-type: application/json' \
    -d "$2" \
    "$CATALOG$1"
}

sha="$(git -C "$REPO_ROOT" rev-parse HEAD)"
echo "youtube-matrix: sha=$sha"

state_json="$(curl_json /youtube/state 10)"
python3 - "$state_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
print("youtube-matrix: command_kind=" + str((payload.get("configured") or {}).get("yt_dlp_command_kind")))
playback = payload.get("playback") or {}
print("youtube-matrix: slot=" + str(playback.get("slot_revision")))
print("youtube-matrix: js=" + str(playback.get("js_runtime")))
print("youtube-matrix: pot=" + str(playback.get("pot_ready")))
PY

play_one() {
  local route="$1"
  local video_id="$2"
  local request_id="yt-matrix-${route}-$(date +%s%N)"
  local accepted out poll
  accepted="$(mktemp)"
  out="$(mktemp)"
  post_json /play-session "{\"request_id\":\"$request_id\",\"source\":\"youtube\",\"type\":\"youtube_video\",\"id\":\"$video_id\"}" 20 >"$accepted"
  python3 - "$accepted" "$route" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True
session = payload.get("session") or {}
print(f"youtube-matrix: route={sys.argv[2]} accepted={session.get('state')}")
open(sys.argv[1] + ".id", "w", encoding="utf-8").write(session.get("session_id") or payload.get("session", {}).get("session_id") or "")
PY
  local session_id
  session_id="$(python3 - "$accepted" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
print((payload.get("session") or {}).get("session_id") or "")
PY
)"
  if [[ -z "$session_id" ]]; then
    session_id="$request_id"
  fi
  local started=$SECONDS
  local state="accepted"
  while (( SECONDS - started < 90 )); do
    curl_json "/play-session/${session_id}?wait_ms=2000" 8 >"$out" || true
    state="$(python3 - "$out" <<'PY'
import json, sys
try:
    payload = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print("unknown")
    raise SystemExit
session = payload.get("session") or {}
print(session.get("state") or "unknown")
PY
)"
    case "$state" in
      playing|failed_before_frame|cancelled|stopped) break ;;
    esac
  done
  python3 - "$out" "$route" "$state" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
session = payload.get("session") or {}
result = session.get("result") or {}
error = session.get("error")
blob = json.dumps(payload)
assert "http://" not in blob.lower()
print(f"youtube-matrix: route={sys.argv[2]} state={sys.argv[3]} error={error is not None} ttff={result.get('ttff_ms')}")
if sys.argv[3] != "playing":
    raise SystemExit(f"youtube-matrix FAIL route={sys.argv[2]} state={sys.argv[3]}")
PY
  if [[ "$STOP" == "1" ]]; then
    post_json /play-cancel "{\"request_id\":\"$request_id\"}" 10 >/dev/null 2>&1 || true
    bash "$REPO_ROOT/scripts/m2-catalog/service/mpv-stop.sh" >/dev/null 2>&1 || true
    sleep 1
  fi
  rm -f "$accepted" "$out"
}

rails_json="$(curl_json /youtube/rails 20)"
python3 - "$rails_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
rails = payload.get("rails") or []
wanted = [
    "for_you", "beyond", "more_like", "new_from_subscriptions",
    "live_now", "history", "saved",
]
found = {rail.get("rail_id"): rail for rail in rails}
for rail_id in wanted:
    rail = found.get(rail_id) or {}
    items = rail.get("items") or []
    video_id = items[0]["id"] if items else ""
    print(f"{rail_id}\t{video_id}\t{len(items)}")
PY
while IFS=$'\t' read -r rail_id video_id count; do
  if [[ -z "$video_id" ]]; then
    echo "youtube-matrix: route=rail:${rail_id} DEFERRED empty_rail count=${count}"
    continue
  fi
  play_one "rail:${rail_id}" "$video_id"
done < <(python3 - "$rails_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
rails = payload.get("rails") or []
wanted = [
    "for_you", "beyond", "more_like", "new_from_subscriptions",
    "live_now", "history", "saved",
]
found = {rail.get("rail_id"): rail for rail in rails}
for rail_id in wanted:
    items = (found.get(rail_id) or {}).get("items") or []
    print(f"{rail_id}\t{(items[0].get('id') if items else '')}\t{len(items)}")
PY
)

echo "youtube-matrix: PASS rails"

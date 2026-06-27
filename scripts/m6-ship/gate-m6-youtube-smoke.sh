#!/usr/bin/env bash
# M6.2 native YouTube smoke gate. Safe by default: state/rails always run,
# API search/detail run only when an API key is configured, and playback runs
# only with MANGO_YOUTUBE_PLAY=1.

set -euo pipefail

CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
QUERY="${MANGO_YOUTUBE_GATE_QUERY:-lofi live}"

curl_json() {
  curl -sf --max-time "${2:-15}" "$CATALOG$1"
}

post_json() {
  local path="$1"
  local body="$2"
  curl -sf --max-time "${3:-20}" \
    -H 'content-type: application/json' \
    -d "$body" \
    "$CATALOG$path"
}

curl -sf --max-time 5 "$CATALOG/health" >/dev/null

state_json="$(curl_json "/youtube/state" 10)"
python3 - "$state_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
assert payload.get("enabled") is True
assert isinstance(payload.get("cache"), dict)
PY

rails_json="$(curl_json "/youtube/rails" 20)"
python3 - "$rails_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
rails = payload.get("rails")
assert isinstance(rails, list)
assert any((rail or {}).get("rail_id") in {"fresh_finds", "popular"} for rail in rails)
PY

api_key="$(
  python3 - "$state_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
print("1" if ((payload.get("configured") or {}).get("api_key")) else "0")
PY
)"

if [[ "$api_key" != "1" ]]; then
  echo "M6.2 YouTube smoke gate ok (API-key search skipped)"
  exit 0
fi

search_json="$(curl_json "/youtube/search?q=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$QUERY")&limit=5" 30)"
video_id="$(
  python3 - "$search_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
groups = payload.get("groups") or {}
videos = groups.get("videos") or []
assert payload.get("ok") is True
assert videos, "youtube search returned no videos"
print(videos[0]["id"])
PY
)"

detail_json="$(curl_json "/youtube/detail?kind=video&id=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$video_id")" 30)"
python3 - "$detail_json" "$video_id" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
assert (payload.get("item") or {}).get("id") == sys.argv[2]
PY

if [[ "${MANGO_YOUTUBE_PLAY:-0}" == "1" ]]; then
  out="$(mktemp)"
  trap 'rm -f "$out"; bash scripts/m2-catalog/service/mpv-stop.sh >/dev/null 2>&1 || true' EXIT
  post_json "/youtube/play" "{\"id\":\"$video_id\"}" 120 >"$out"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True
assert int(payload.get("ttff_ms") or 0) > 0
PY
fi

echo "M6.2 YouTube smoke gate ok"

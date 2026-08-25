#!/usr/bin/env bash
# Production play-session YouTube route matrix. Records privacy-safe evidence
# only: SHAs, timings, classified outcomes. Never prints URLs or titles.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
STOP="${MANGO_YOUTUBE_MATRIX_STOP:-1}"
CORPUS="$REPO_ROOT/scripts/m6-ship/youtube-acceptance-corpus.json"

curl_json() {
  curl -sf --max-time "${2:-20}" "$CATALOG$1"
}

post_json() {
  curl -sf --max-time "${3:-20}" \
    -H 'content-type: application/json' \
    -d "$2" \
    "$CATALOG$1"
}

stop_playback() {
  if [[ "$STOP" == "1" ]]; then
    # Do not POST /play-cancel between rails: that bumps the global play epoch
    # and can cancel the next route's in-flight resolve.
    bash "$REPO_ROOT/scripts/m2-catalog/service/mpv-stop.sh" >/dev/null 2>&1 || true
    sleep 2
  fi
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

assert_mpv_av_ready() {
  local route="$1"
  local expected_start="${2:-0}"
  python3 - "${MANGO_MPV_SOCKET:-$HOME/.cache/mango/mpv.sock}" "$route" "$expected_start" <<'PY'
import json
import math
import socket
import sys
import time

sock_path, route, expected_start_raw = sys.argv[1:]
expected_start = float(expected_start_raw or 0)

def ipc(prop):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(2)
        client.connect(sock_path)
        client.sendall((json.dumps({"command": ["get_property", prop]}) + "\n").encode())
        data = b""
        while b"\n" not in data:
            chunk = client.recv(4096)
            if not chunk:
                break
            data += chunk
    return json.loads(data.decode()).get("data")

def sample():
    return {key: ipc(key) for key in (
        "playback-time", "audio-pts", "avsync",
        "vo-configured", "estimated-vf-fps", "current-ao",
        "vid", "aid", "mute", "pause",
    )}

def number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)

deadline = time.time() + 8
first = None
while time.time() < deadline:
    try:
        candidate = sample()
    except (OSError, ValueError):
        time.sleep(0.1)
        continue
    if (
        candidate["vo-configured"] is True
        and number(candidate["estimated-vf-fps"]) and candidate["estimated-vf-fps"] > 0
        and isinstance(candidate["vid"], int) and candidate["vid"] > 0
        and isinstance(candidate["aid"], int) and candidate["aid"] > 0
        and candidate["current-ao"] not in (None, False, "null")
        and candidate["mute"] is False and candidate["pause"] is False
        and all(number(candidate[key]) for key in ("playback-time", "audio-pts", "avsync"))
        and abs(candidate["avsync"]) <= 0.5
    ):
        first = candidate
        break
    time.sleep(0.1)
assert first is not None, f"youtube-matrix FAIL route={route} no conjunctive A/V readiness"
if expected_start > 0:
    assert first["playback-time"] >= expected_start - 1, (
        f"youtube-matrix FAIL route={route} resume={first['playback-time']}"
    )
time.sleep(0.5)
second = sample()
assert second["playback-time"] - first["playback-time"] >= 0.2, (first, second)
assert second["audio-pts"] - first["audio-pts"] >= 0.1, (first, second)
assert abs(second["avsync"]) <= 0.5, second
print(
    f"youtube-matrix: route={route} av_ready=true "
    f"playback={second['playback-time']:.2f} fps={second['estimated-vf-fps']} "
    f"ao={second['current-ao']} avsync={second['avsync']:.4f}"
)
PY
}

# Sets PLAY_OUTCOME to playing, classified, or fail. Returns 0 unless fail.
play_one() {
  local route="$1"
  local video_id="$2"
  local start_sec="${3:-}"
  local request_id="yt-matrix-${route}-$(date +%s%N)"
  local accepted out rc body
  accepted="$(mktemp)"
  out="$(mktemp)"
  body="{\"request_id\":\"$request_id\",\"source\":\"youtube\",\"type\":\"youtube_video\",\"id\":\"$video_id\""
  if [[ "$start_sec" =~ ^[0-9]+$ ]] && (( start_sec > 0 )); then
    body+=",\"start_sec\":$start_sec"
  fi
  body+="}"
  post_json /play-session "$body" 20 >"$accepted"
  python3 - "$accepted" "$route" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True
session = payload.get("session") or {}
print(f"youtube-matrix: route={sys.argv[2]} accepted={session.get('state')}")
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
  set +e
  python3 - "$out" "$route" "$state" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
session = payload.get("session") or {}
result = session.get("result") or {}
stream = result.get("stream") or {}
error = session.get("error")
error_text = error if isinstance(error, str) else json.dumps(error or "")
blob = json.dumps(payload)
assert "http://" not in blob.lower()
assert "googlevideo" not in blob.lower()
height = stream.get("height")
if sys.argv[3] == "playing":
    assert isinstance(height, (int, float)) and 0 < height <= 1080, (
        f"youtube-matrix FAIL route={sys.argv[2]} invalid_height={height}"
    )
print(
    f"youtube-matrix: route={sys.argv[2]} state={sys.argv[3]} "
    f"error={error is not None} resolve={stream.get('resolve_ms')} "
    f"ttff={result.get('ttff_ms')} height={height} fps={stream.get('fps')}"
)
state = sys.argv[3]
if state == "playing":
    raise SystemExit(0)
classified = (
    "blocked this video",
    "unavailable",
    "asking for browser verification",
    "temporarily busy",
)
if state == "cancelled":
    print(f"youtube-matrix: route={sys.argv[2]} cancelled")
    raise SystemExit(3)
if state == "failed_before_frame" and any(token in error_text.lower() for token in classified):
    print(f"youtube-matrix: route={sys.argv[2]} classified_unplayable")
    raise SystemExit(2)
raise SystemExit(f"youtube-matrix FAIL route={sys.argv[2]} state={state}")
PY
  local rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    assert_mpv_av_ready "$route" "${start_sec:-0}"
  fi
  stop_playback "$request_id"
  rm -f "$accepted" "$out"
  case "$rc" in
    0) PLAY_OUTCOME=playing; return 0 ;;
    2) PLAY_OUTCOME=classified; return 0 ;;
    3) PLAY_OUTCOME=cancelled; return 0 ;;
    *) PLAY_OUTCOME=fail; return 1 ;;
  esac
}

play_rail() {
  local rail_id="$1"
  local ids_json="$2"
  local ids
  mapfile -t ids < <(python3 - "$ids_json" <<'PY'
import json, sys
for item in json.loads(sys.argv[1]):
    video_id = str(item or "").strip()
    if video_id:
        print(video_id)
PY
)
  if [[ "${#ids[@]}" -eq 0 ]]; then
    echo "youtube-matrix: route=rail:${rail_id} DEFERRED empty_rail"
    return 0
  fi
  local classified=0
  local id
  for id in "${ids[@]}"; do
    local attempts=0
    while (( attempts < 2 )); do
      attempts=$((attempts + 1))
      play_one "rail:${rail_id}" "$id"
      if [[ "$PLAY_OUTCOME" == "playing" ]]; then
        echo "youtube-matrix: route=rail:${rail_id} PASS"
        return 0
      fi
      if [[ "$PLAY_OUTCOME" != "cancelled" ]]; then
        break
      fi
      echo "youtube-matrix: route=rail:${rail_id} retry after cancel"
      stop_playback
    done
    if [[ "$PLAY_OUTCOME" == "classified" || "$PLAY_OUTCOME" == "cancelled" ]]; then
      classified=$((classified + 1))
      continue
    fi
    return 1
  done
  echo "youtube-matrix: route=rail:${rail_id} PASS classified_unplayable=${classified}"
}

play_interrupt() {
  local video_id="$1"
  local request_id="yt-matrix-interrupt-$(date +%s%N)"
  local accepted out
  accepted="$(mktemp)"
  out="$(mktemp)"
  post_json /play-session "{\"request_id\":\"$request_id\",\"source\":\"youtube\",\"type\":\"youtube_video\",\"id\":\"$video_id\"}" 20 >"$accepted"
  python3 - "$accepted" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True
print("youtube-matrix: route=interrupt accepted=" + str((payload.get("session") or {}).get("state")))
PY
  sleep 1
  post_json /play-cancel "{\"request_id\":\"$request_id\"}" 10 >/dev/null
  bash "$REPO_ROOT/scripts/m2-catalog/service/mpv-stop.sh" >/dev/null 2>&1 || true
  local session_id
  session_id="$(python3 - "$accepted" <<'PY'
import json, sys
print(((json.load(open(sys.argv[1], encoding="utf-8")).get("session") or {}).get("session_id")) or "")
PY
)"
  local started=$SECONDS
  local state="accepted"
  while (( SECONDS - started < 30 )); do
    curl_json "/play-session/${session_id}?wait_ms=1000" 5 >"$out" || true
    state="$(python3 - "$out" <<'PY'
import json, sys
try:
    print(((json.load(open(sys.argv[1], encoding="utf-8")).get("session") or {}).get("state")) or "unknown")
except Exception:
    print("unknown")
PY
)"
    case "$state" in
      cancelled|stopped|failed_before_frame) break ;;
    esac
  done
  python3 - "$out" "$state" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
blob = json.dumps(payload)
assert "http://" not in blob.lower()
state = sys.argv[2]
print(f"youtube-matrix: route=interrupt state={state}")
if state not in ("cancelled", "stopped", "failed_before_frame"):
    raise SystemExit(f"youtube-matrix FAIL route=interrupt state={state}")
PY
  stop_playback "$request_id"
  rm -f "$accepted" "$out"
  echo "youtube-matrix: route=interrupt PASS"
}

rails_json="$(curl_json /youtube/rails 20)"
python3 - "$rails_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
wanted = [
    "for_you", "new_from_subscriptions", "frequently_watched",
    "more_like", "beyond", "history", "saved", "live_now",
]
found = {rail.get("rail_id"): rail for rail in payload.get("rails") or []}
for rail_id in wanted:
    items = (found.get(rail_id) or {}).get("items") or []
    print(f"youtube-matrix: rail={rail_id} cards={len(items)}")
PY

while IFS=$'\t' read -r rail_id ids_json; do
  play_rail "$rail_id" "$ids_json"
done < <(python3 - "$rails_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
wanted = [
    "for_you", "new_from_subscriptions", "frequently_watched",
    "more_like", "beyond", "history", "saved", "live_now",
]
found = {rail.get("rail_id"): rail for rail in payload.get("rails") or []}
for rail_id in wanted:
    ids = [item.get("id") for item in ((found.get(rail_id) or {}).get("items") or []) if item.get("id")]
    print(f"{rail_id}\t{json.dumps(ids)}")
PY
)

corpus_id="$(python3 - "$CORPUS" <<'PY'
import json, sys
items = json.load(open(sys.argv[1], encoding="utf-8")).get("items") or []
for item in items:
    if item.get("id") == "ordinary_vod":
        print(item.get("video_id") or "")
        break
PY
)"
if [[ -n "$corpus_id" ]]; then
  play_one "corpus:ordinary_vod" "$corpus_id"
  if [[ "$PLAY_OUTCOME" == "playing" ]]; then
    echo "youtube-matrix: route=corpus:ordinary_vod PASS"
    play_interrupt "$corpus_id"
  else
    echo "youtube-matrix: route=corpus:ordinary_vod PASS classified_unplayable"
  fi
fi

resume_corpus_id="$(python3 - "$CORPUS" <<'PY'
import json, sys
items = json.load(open(sys.argv[1], encoding="utf-8")).get("items") or []
for item in items:
    if item.get("id") == "long_vod":
        print(item.get("video_id") or "")
        break
PY
)"
if [[ -n "$resume_corpus_id" ]]; then
  play_one "corpus:resume_vod" "$resume_corpus_id" 60
  if [[ "$PLAY_OUTCOME" != "playing" ]]; then
    echo "youtube-matrix FAIL route=corpus:resume_vod outcome=$PLAY_OUTCOME" >&2
    exit 1
  fi
  echo "youtube-matrix: route=corpus:resume_vod PASS"
fi

echo "youtube-matrix: PASS rails"

#!/usr/bin/env bash
# Phase N3a play gate — random browse pick, Shawshank regression, prior gates.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

TMP_DIR="${TMPDIR:-/tmp}/mango-n3-gate"
mkdir -p "$TMP_DIR"

ERRORS=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }

cleanup() {
  bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "========== mango N3 play gate $(date -Iseconds) =========="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

echo "--- prereqs ---"
bash scripts/phase-n3/check-n3-prereqs.sh && pass "check-n3-prereqs" || fail "check-n3-prereqs"

echo "--- random trending-india pick ---"
TRENDING_JSON="$TMP_DIR/trending-india.json"
PICK_JSON="$TMP_DIR/trending-pick.json"
if curl -sf --max-time 70 http://127.0.0.1:3020/rails/trending-india/items >"$TRENDING_JSON"; then
  python3 - "$TRENDING_JSON" "$PICK_JSON" <<'PY' && pass "selected random trending-india title" || fail "select random trending-india title"
import json
import random
import sys
source, target = sys.argv[1], sys.argv[2]
data = json.load(open(source, encoding="utf-8"))
items = [
    item for item in data.get("items", [])
    if item.get("id") and item.get("id") != "tt0111161"
]
if not items:
    raise SystemExit("trending-india returned no non-Shawshank items")
pick = random.SystemRandom().choice(items)
json.dump(pick, open(target, "w", encoding="utf-8"))
print(f"  pick: {pick.get('title')} ({pick.get('id')})")
PY
else
  fail "GET /rails/trending-india/items"
fi

json_field() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
path, key = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
value = data.get(key, "")
print(value if value is not None else "")
PY
}

check_play_json() {
  local label="$1"
  local path="$2"
  python3 - "$label" "$path" <<'PY'
import json
import sys
label, path = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
if data.get("ok") is not True:
    raise SystemExit(f"{label}: ok is not true: {data}")
total = int(data.get("total_ms") or 0)
ttff = int(data.get("ttff_ms") or 0)
attempts = int(data.get("attempts") or 0)
filters = data.get("filters") or {}
fallback = filters.get("torbox_uncached_fallback") is True or filters.get("rd_safe_unknown_fallback") is True
max_total = 60000 if fallback else 20000
if total <= 0 or total > max_total:
    raise SystemExit(f"{label}: total_ms outside budget: {total} (max {max_total})")
if ttff <= 0:
    raise SystemExit(f"{label}: ttff_ms missing: {ttff}")
if attempts < 1 or attempts > 4:
    raise SystemExit(f"{label}: attempts outside budget: {attempts}")
stream = data.get("stream") or {}
filters = data.get("filters") or {}
excluded = filters.get("excluded") or {}
print(
    f"  {label}: total_ms={total} ttff_ms={ttff} attempts={attempts} "
    f"stream={stream.get('source')} {stream.get('quality')} cache={stream.get('cache_status')} "
    f"excluded_uncached={excluded.get('uncached_debrid', 0)} "
    f"excluded_unknown={excluded.get('unknown_cache_debrid', 0)}"
)
PY
}

check_mpv_playing() {
  local label="$1"
  for _ in $(seq 1 25); do
    local reply
    reply="$(bash scripts/phase-n1/mpv-ipc.sh get_property playback-time 2>/dev/null || true)"
    local playback_time
    playback_time="$(printf '%s' "$reply" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("data") or 0)' 2>/dev/null || echo 0)"
    if python3 -c "import sys; sys.exit(0 if float('${playback_time:-0}') > 0 else 1)" 2>/dev/null; then
      pass "$label mpv playback-time ${playback_time}"
      return 0
    fi
    sleep 0.2
  done
  fail "$label mpv playback-time > 0"
  return 1
}

post_play() {
  local label="$1"
  local type="$2"
  local id="$3"
  local out="$4"
  if curl -sf --max-time 60 -X POST http://127.0.0.1:3020/play \
    -H 'content-type: application/json' \
    -d "{\"type\":\"${type}\",\"id\":\"${id}\"}" >"$out"; then
    check_play_json "$label" "$out" && pass "$label POST /play" || fail "$label POST /play budget"
    check_mpv_playing "$label" || true
  else
    fail "$label POST /play"
  fi
}

if [[ -f "$PICK_JSON" ]]; then
  PICK_ID="$(json_field "$PICK_JSON" id)"
  PICK_TYPE="$(json_field "$PICK_JSON" type)"
  PICK_TITLE="$(json_field "$PICK_JSON" title)"
  BROWSE_OUT="$TMP_DIR/play-browse.json"
  echo "--- browse pick play: ${PICK_TITLE} (${PICK_ID}) ---"
  post_play "browse pick" "$PICK_TYPE" "$PICK_ID" "$BROWSE_OUT"
  bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
fi

echo "--- Shawshank regression ---"
SHAWSHANK_OUT="$TMP_DIR/play-shawshank.json"
post_play "shawshank" "movie" "tt0111161" "$SHAWSHANK_OUT"
bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true

echo "--- N2/N1/N0 regression ---"
if bash scripts/phase-n2/gate-n2-browse.sh; then
  pass "gate-n2-browse (includes N1/N0)"
else
  fail "gate-n2-browse (includes N1/N0)"
fi

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "N3 gate: PASS"
  exit 0
fi
echo "N3 gate: FAIL (${ERRORS} errors)"
exit 1

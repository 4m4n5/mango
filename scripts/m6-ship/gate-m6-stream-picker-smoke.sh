#!/usr/bin/env bash
# Non-mutating Pi proof for evidence-based stream selection + in-mpv picker.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CATALOG_URL="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
ACTIVE_FILE="${MANGO_ACTIVE_STREAMS_PATH:-$HOME/.cache/mango/active-streams.json}"
FILTERS="${MANGO_CATALOG_FILTERS:-$HOME/.config/mango/catalog-filters.4k-hifi.json}"
ENV_FILE="${MANGO_PLAYBACK_ENV_FILE:-$HOME/.config/mango/voice.env}"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

cd "$REPO_DIR"

curl -fsS --max-time 5 "$CATALOG_URL/health" >/dev/null \
  || fail "catalog health unavailable"

state="$(curl -fsS --max-time 5 "$CATALOG_URL/play-session/active/streams")" \
  || fail "active stream API unavailable"
python3 - "$state" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
state = payload.get("streams") or {}
assert state.get("enabled") in (True, False)
assert isinstance(state.get("revision"), int)
assert len(state.get("candidates") or []) <= 8
encoded = json.dumps(state).lower()
assert '"url"' not in encoded
assert "http://" not in encoded
assert "https://" not in encoded
if state.get("session_id"):
    current = state.get("current_candidate_id")
    candidates = state.get("candidates") or []
    assert current
    assert any(row.get("candidate_id") == current and row.get("current") is True for row in candidates)
    assert all(row.get("capability_class") in ("proven_smooth", "unknown", "known_risky") for row in candidates)
print("PASS: active stream API is bounded, revisioned, and URL-free")
PY

if [[ -f "$ACTIVE_FILE" ]]; then
  python3 - "$ACTIVE_FILE" <<'PY'
import json
import pathlib
import sys

raw = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
json.loads(raw)
lowered = raw.lower()
assert '"url"' not in lowered
assert "http://" not in lowered
assert "https://" not in lowered
print("PASS: persisted picker snapshot contains no stream URLs")
PY
fi

[[ -f "$FILTERS" ]] || fail "active hifi filter profile missing: $FILTERS"
python3 - "$FILTERS" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
assert int(data.get("auto_play_wall_ms") or 0) == 120000
assert int(data.get("auto_play_max_attempts") or 0) >= 20
main = data.get("main_ladder") or []
assert any(
    row.get("min_quality") == "2160p"
    and row.get("require_hevc") is True
    and row.get("exclude_hdr") is True
    for row in main
)
print("PASS: 120s evidence ladder and Pi 4K SDR policy are installed")
PY

if [[ -f "$ENV_FILE" ]]; then
  grep -q '^MANGO_PLAYBACK_CAPABILITY_PROFILE=pi5-x11-mpv-hifi$' "$ENV_FILE" \
    || fail "playback capability profile is not installed"
  grep -q '^MANGO_STREAM_PICKER=1$' "$ENV_FILE" \
    || fail "stream picker kill switch is not enabled"
fi

if pgrep -f 'playback-osd\.py --run' >/dev/null 2>&1; then
  fail "legacy external playback overlay is running"
fi

grep -q 'mango-streams-toggle' scripts/m1-foundation/pad/mango-tv-pad.py \
  || fail "pad X is not wired to the mpv Streams panel"
grep -q 'mango-streams-close' scripts/m1-foundation/pad/mango-tv-pad.py \
  || fail "pad Back precedence is not wired for the Streams panel"
grep -q 'mp.register_script_message("mango-streams-select"' \
  scripts/m2-catalog/service/mango-hud.lua \
  || fail "mpv HUD stream selection command is missing"
pass "pad and mpv HUD stream controls are wired"

if pgrep -f 'mpv.*--input-ipc-server=.*/mpv\.sock' >/dev/null 2>&1; then
  main_count="$(pgrep -fc 'mpv.*--input-ipc-server=.*/mpv\.sock' || true)"
  [[ "$main_count" -eq 1 ]] || fail "expected one foreground mpv owner, found $main_count"
fi

python3 - "${MANGO_PLAYABILITY_DB:-/etc/mango/playability.db}" <<'PY'
import sqlite3
import sys

db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
try:
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "stream_path_evidence" in tables
finally:
    db.close()
print("PASS: path-scoped stream evidence schema is present")
PY

pass "stream picker smoke"

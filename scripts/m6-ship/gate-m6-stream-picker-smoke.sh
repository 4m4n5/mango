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
assert len(state.get("candidates") or []) <= 5
encoded = json.dumps(state).lower()
assert '"url"' not in encoded
assert "http://" not in encoded
assert "https://" not in encoded
if state.get("session_id"):
    current = state.get("current_candidate_id")
    candidates = state.get("candidates") or []
    assert current
    assert candidates and candidates[0].get("candidate_id") == current
    assert candidates[0].get("current") is True
    unavailable_seen = False
    for row in candidates[1:]:
        unavailable_seen = unavailable_seen or row.get("unavailable") is True
        if unavailable_seen:
            assert row.get("unavailable") is True
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
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  [[ "${MANGO_PLAYBACK_CAPABILITY_PROFILE:-}" == "pi5-x11-mpv-hifi" ]] \
    || fail "playback capability profile is not installed"
  [[ "${MANGO_STREAM_PICKER:-}" == "1" ]] \
    || fail "stream picker kill switch is not enabled"
fi

if pgrep -f 'playback-osd\.py --run' >/dev/null 2>&1; then
  fail "legacy external playback overlay is running"
fi

grep -q 'mango-streams-toggle' scripts/m1-foundation/pad/mango-tv-pad.py \
  || fail "pad X is not wired to the mpv Streams panel"
grep -q 'mango-streams-close' scripts/m1-foundation/pad/mango-tv-pad.py \
  || fail "pad Back precedence is not wired for the Streams panel"
grep -q 'send_mpv_command' scripts/m1-foundation/pad/mango-tv-pad.py \
  || fail "pad actions are not serialized through ordered mpv IPC"
python3 scripts/m1-foundation/pad/test_pad_mpv_ipc.py >/dev/null \
  || fail "ordered mpv IPC unit test failed"
python3 scripts/m1-foundation/pad/test_pad_context.py >/dev/null \
  || fail "contextual X ownership unit test failed"
grep -q 'mp.register_script_message("mango-streams-select"' \
  scripts/m2-catalog/service/mango-hud.lua \
  || fail "mpv HUD stream selection command is missing"
pass "pad and mpv HUD stream controls are wired"

if systemctl --user is-active --quiet mango-tv-pad.service; then
  pad_started="$(
    systemctl --user show mango-tv-pad.service --property=ActiveEnterTimestamp --value
  )"
  pad_started_epoch="$(date --date="$pad_started" +%s 2>/dev/null || echo 0)"
  pad_source_epoch="$(stat --format=%Y scripts/m1-foundation/pad/mango-tv-pad.py)"
  [[ "$pad_started_epoch" -ge "$pad_source_epoch" ]] \
    || fail "running pad router predates its source; restart mango-tv-pad.service"
  pass "running pad router has loaded the deployed source"
fi

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

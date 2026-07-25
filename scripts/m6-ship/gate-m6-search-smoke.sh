#!/usr/bin/env bash
# Non-mutating unified Search smoke. Diagnostic mode uses local/cached sources only.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mango-search-gate.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init
gate_header "M6 unified Search smoke"

STATE_BEFORE="$TMP_DIR/state-before.json"
STATE_AFTER="$TMP_DIR/state-after.json"
SUGGESTIONS="$TMP_DIR/suggestions.json"
START="$TMP_DIR/start.json"
SNAPSHOT="$TMP_DIR/snapshot.json"
MPV_PID_FILE="${MANGO_MPV_PID_FILE:-$HOME/.cache/mango/mpv.pid}"
MPV_PID_BEFORE="$(cat "$MPV_PID_FILE" 2>/dev/null || true)"

if curl -sf --max-time 5 "$CATALOG/search/state" >"$STATE_BEFORE"; then
  gate_pass "Search state API"
else
  gate_fail "Search state API unavailable at $CATALOG"
  gate_finish "gate-m6-search-smoke" || exit 1
fi

QUERY="$(python3 - "$STATE_BEFORE" <<'PY'
import json
import sys
state = json.load(open(sys.argv[1], encoding="utf-8"))
for item in state.get("starters", []):
    title = str(item.get("title", "")).strip()
    if len(title) >= 2:
        print(title[:80])
        break
else:
    print("the")
PY
)"

SUGGEST_TIME="$(curl -sS --max-time 5 -o "$SUGGESTIONS" -w '%{time_total}' \
  "$CATALOG/search/suggestions?q=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$QUERY")&scope=all&limit=9" \
  2>/dev/null || echo 99)"
if python3 - "$SUGGESTIONS" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data.get("ok") is True
assert isinstance(data.get("suggestions"), list)
assert len(data["suggestions"]) <= 9
PY
then
  gate_pass "local suggestions query='$QUERY' latency=${SUGGEST_TIME}s"
else
  gate_fail "local suggestions response"
fi

python3 - "$QUERY" >"$TMP_DIR/request.json" <<'PY'
import json
import sys
print(json.dumps({"query": sys.argv[1], "scope": "all", "diagnostic": True}))
PY
HTTP_CODE="$(curl -sS --max-time 5 -o "$START" -w '%{http_code}' \
  -X POST "$CATALOG/search/query" \
  -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/request.json" 2>/dev/null || true)"
if [[ "$HTTP_CODE" == "202" ]]; then
  gate_pass "diagnostic Search accepted without activity write"
else
  gate_fail "diagnostic Search acceptance HTTP=$HTTP_CODE"
  gate_finish "gate-m6-search-smoke" || exit 1
fi

SEARCH_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["search_id"])' "$START")"
REVISION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["revision"])' "$START")"
cp "$START" "$SNAPSHOT"
for _attempt in 1 2 3 4 5 6; do
  if python3 -c 'import json,sys; raise SystemExit(0 if json.load(open(sys.argv[1],encoding="utf-8")).get("complete") else 1)' "$SNAPSHOT"; then
    break
  fi
  curl -sf --max-time 4 \
    "$CATALOG/search/query/$SEARCH_ID?after_revision=$REVISION&wait_ms=1500" >"$SNAPSHOT"
  REVISION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8"))["revision"])' "$SNAPSHOT")"
done

if python3 - "$SNAPSHOT" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data.get("complete") is True
assert data.get("revision", 0) >= 2
assert isinstance(data.get("groups"), list)
phases = data.get("phases", {})
assert phases.get("external", {}).get("status") == "skipped"
assert phases.get("live", {}).get("status") == "skipped"
assert phases.get("ai", {}).get("status") == "skipped"
assert phases.get("youtube", {}).get("status") in {"ready", "empty", "degraded"}
assert all(isinstance(group.get("items"), list) for group in data["groups"])
PY
then
  gate_pass "progressive long-poll completed with cache-only phase isolation"
else
  gate_fail "progressive Search snapshot contract"
fi

curl -sf --max-time 5 "$CATALOG/search/state" >"$STATE_AFTER"
if python3 - "$STATE_BEFORE" "$STATE_AFTER" <<'PY'
import json
import sys
before = json.load(open(sys.argv[1], encoding="utf-8"))
after = json.load(open(sys.argv[2], encoding="utf-8"))
assert before.get("recents", []) == after.get("recents", [])
before_quota = before.get("youtube", {}).get("refresh", {}).get("quota_used_today")
after_quota = after.get("youtube", {}).get("refresh", {}).get("quota_used_today")
assert before_quota == after_quota
PY
then
  gate_pass "diagnostic Search preserved history and YouTube quota"
else
  gate_fail "diagnostic Search mutated activity or quota"
fi

MPV_PID_AFTER="$(cat "$MPV_PID_FILE" 2>/dev/null || true)"
if [[ "$MPV_PID_BEFORE" == "$MPV_PID_AFTER" ]]; then
  gate_pass "Search caused no playback side effect"
else
  gate_fail "playback PID changed during Search smoke"
fi

gate_finish "gate-m6-search-smoke" || exit 1

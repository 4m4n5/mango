#!/usr/bin/env bash
# M6.1 Mango-owned library smoke gate. Writes a temporary gate-scoped Saved row
# and removes it before exit so household Saved state is not polluted.

set -euo pipefail

CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
TYPE="movie"
ID="tt0111161"
SOURCE="gate"
TAB="movies"
TITLE="Mango Gate Library Smoke"

json_post() {
  local path="$1"
  local body="$2"
  curl -sf --max-time 10 \
    -H 'content-type: application/json' \
    -d "$body" \
    "$CATALOG$path"
}

json_delete() {
  local path="$1"
  local body="$2"
  curl -sf --max-time 10 \
    -X DELETE \
    -H 'content-type: application/json' \
    -d "$body" \
    "$CATALOG$path"
}

cleanup() {
  if [[ -n "${PREVIOUS_CONTEXT:-}" ]]; then
    json_post "/library/context" "$PREVIOUS_CONTEXT" >/dev/null 2>&1 || true
  else
    json_delete "/library/context" "{}" >/dev/null 2>&1 || true
  fi
  json_delete "/library/saved" "{\"source\":\"$SOURCE\",\"type\":\"$TYPE\",\"id\":\"$ID\"}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

curl -sf --max-time 5 "$CATALOG/health" >/dev/null
curl -sf --max-time 10 "$CATALOG/library/saved?limit=1" >/dev/null
curl -sf --max-time 10 "$CATALOG/library/history?limit=1" >/dev/null

PREVIOUS_CONTEXT="$(
  curl -sf --max-time 10 "$CATALOG/library/context" \
    | python3 -c 'import json,sys; ctx=json.load(sys.stdin).get("context"); print(json.dumps(ctx) if ctx else "")'
)"

json_post "/library/context" \
  "{\"source\":\"$SOURCE\",\"tab\":\"$TAB\",\"type\":\"$TYPE\",\"id\":\"$ID\",\"title\":\"$TITLE\"}" >/dev/null

save_json="$(json_post "/library/saved" "{\"current\":true,\"saved_by\":\"gate\"}")"
python3 - "$save_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
state = payload.get("state") or {}
assert state.get("saved") is True
assert state.get("source") == "gate"
PY

state_json="$(curl -sf --max-time 10 "$CATALOG/library/state?source=$SOURCE&type=$TYPE&id=$ID")"
python3 - "$state_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
state = payload.get("state") or {}
assert state.get("saved") is True
PY

curl -sf --max-time 10 "$CATALOG/pins?tab=$TAB" >/dev/null

delete_json="$(json_delete "/library/saved" "{\"current\":true}")"
python3 - "$delete_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
assert payload.get("removed") in (0, 1, True)
PY

state_json="$(curl -sf --max-time 10 "$CATALOG/library/state?source=$SOURCE&type=$TYPE&id=$ID")"
python3 - "$state_json" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
state = payload.get("state") or {}
assert state.get("saved") is False
PY

echo "M6.1 library smoke gate ok"

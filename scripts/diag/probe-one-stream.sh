#!/usr/bin/env bash
# Systematic single-stream playability diagnosis (run on Pi with catalog up).
#
# Usage:
#   bash scripts/diag/probe-one-stream.sh movie tt0111161
#   bash scripts/diag/probe-one-stream.sh series tt0944947
#
# Layers:
#   1. POST /play  — couch path (fullscreen mpv via catalog-service)
#   2. GET /stream — resolve + filter only
#   3. headless probe — mpv-probe-ipc.sh on top stream URL
#   4. indexer verify — playability-indexer.ts verify

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

TYPE="${1:-}"
ID="${2:-}"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
TMP="${TMPDIR:-/tmp}/mango-probe-one-$$"
mkdir -p "$TMP"
trap 'bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

[[ -n "$TYPE" && -n "$ID" ]] || {
  echo "usage: $0 <movie|series> <id>" >&2
  exit 2
}

step() { echo; echo "== $* =="; }

fail() { echo "FAIL: $*" >&2; exit 1; }

step "0. preflight"
curl -sf --max-time 5 "$CATALOG/health" >/dev/null || fail "catalog down at $CATALOG"
echo "OK catalog"

step "1. couch play (POST /play)"
bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
PLAY_JSON="$TMP/play.json"
if curl -sf --max-time 90 -X POST "$CATALOG/play" \
  -H 'content-type: application/json' \
  -d "{\"type\":\"${TYPE}\",\"id\":\"${ID}\"}" >"$PLAY_JSON"; then
  python3 - "$PLAY_JSON" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
attempts = data.get("attempts")
attempt_n = attempts if isinstance(attempts, int) else len(attempts or [])
print(f"  ok={data.get('ok')} ttff_ms={data.get('ttff_ms')} attempts={attempt_n}")
stream = data.get("stream") or {}
print(f"  source={stream.get('source')} cache={stream.get('cache_status')} debrid={stream.get('debrid_service')}")
PY
else
  echo "  FAIL: POST /play"
fi
bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true

step "2. stream resolve (GET /stream)"
STREAM_JSON="$TMP/stream.json"
curl -sf --max-time 120 "$CATALOG/stream/${TYPE}/${ID}" >"$STREAM_JSON" \
  || fail "GET /stream/${TYPE}/${ID}"
python3 - "$STREAM_JSON" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
streams = data.get("streams") or []
filt = data.get("filters") or {}
print(f"  kept={filt.get('kept', len(streams))} resolve_ms={data.get('resolve_ms')}")
if not streams:
    raise SystemExit("no streams after filters")
s = streams[0]
print(f"  top: source={s.get('source')} cache={s.get('cache_status')} debrid={s.get('debrid_service')}")
print(f"  url_host={s.get('url','')[:80]}...")
with open(sys.argv[1].replace('.json', '.url'), 'w') as f:
    f.write(s['url'])
PY
URL="$(cat "$TMP/stream.url")"

step "3. headless probe (mpv-probe-ipc)"
bash scripts/phase-n3c/mpv-probe-pool.sh stop-all >/dev/null 2>&1 || true
bash scripts/phase-n3c/mpv-probe-pool.sh ensure --workers 1
PROBE_LOG="$TMP/probe.log"
set +e
bash scripts/phase-n3c/mpv-probe-ipc.sh \
  --worker-id 0 \
  --url "$URL" \
  --timeout-ms "${MANGO_PLAYABILITY_PROBE_MS:-20000}" \
  --probe \
  >"$PROBE_LOG" 2>&1
PROBE_RC=$?
set -e
cat "$PROBE_LOG"
echo "  probe exit=$PROBE_RC"

step "4. indexer verify (maintenance flags, no batch db)"
export MANGO_MAINTENANCE_MODE=1
export MANGO_PLAYABILITY_PROBE_POOL=1
export MANGO_PLAYABILITY_BATCH_DB=0
export MANGO_PLAYABILITY_PROBE_MS="${MANGO_PLAYABILITY_PROBE_MS:-20000}"
set +e
npm --prefix src/catalog-service exec tsx -- \
  scripts/phase-n3c/playability-indexer.ts verify --type "$TYPE" --id "$ID"
VERIFY_RC=$?
set -e
echo "  verify exit=$VERIFY_RC"

step "summary"
echo "  play_json=$PLAY_JSON stream_json=$STREAM_JSON probe_log=$PROBE_LOG"
if [[ "$PROBE_RC" -eq 0 && "$VERIFY_RC" -eq 0 ]]; then
  echo "RESULT: single-stream verify path OK"
  exit 0
fi
echo "RESULT: investigate failing layer above"
exit 1

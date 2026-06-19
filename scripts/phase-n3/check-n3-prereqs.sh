#!/usr/bin/env bash
# N3 prerequisites — filters + mpv probe support (probe smoke off by default).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"
QUIET="${MANGO_GATE_QUIET:-0}"
log() { [[ "$QUIET" == "1" ]] || echo "$@"; }

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

ERRORS=0
fail() { log "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }

FILTERS="config/catalog-filters.example.json"
[[ -f "$FILTERS" ]] || fail "missing $FILTERS"
[[ -f src/catalog-service/dist/index.js ]] || fail "catalog-service dist missing"
[[ -f src/launcher/dist/index.html ]] || fail "launcher dist missing"
command -v mpv >/dev/null || fail "mpv missing"
command -v socat >/dev/null || fail "socat missing"
curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null || fail "catalog :3020 down"

if [[ "${MANGO_N3_PROBE_SMOKE:-0}" == "1" ]]; then
  PROBE_URL="${MANGO_N3_PROBE_MP4_URL:-https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4}"
  bash scripts/phase-n1/mpv-play.sh --url "$PROBE_URL" --probe --timeout-ms 8000 \
    || fail "mpv probe smoke"
fi

(( ERRORS == 0 ))

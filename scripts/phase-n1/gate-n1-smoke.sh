#!/usr/bin/env bash
# Phase N1 gates — see docs/tasks/phase-n1-catalog-play-spike.md

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

ERRORS=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; ERRORS=$((ERRORS + 1)); }

echo "========== mango N1 smoke gate $(date -Iseconds) =========="
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

SMOKE_ID="${MANGO_SMOKE_TITLE_ID:-tt0111161}"

echo "--- prereqs ---"
bash scripts/phase-n1/check-n1-prereqs.sh && pass "check-n1-prereqs" || fail "check-n1-prereqs"

echo "--- S0 mpv HTTP ---"
if [[ -x scripts/phase-n1/spike-mpv-http.sh ]]; then
  bash scripts/phase-n1/spike-mpv-http.sh && pass "spike-mpv-http" || fail "spike-mpv-http"
else
  fail "missing scripts/phase-n1/spike-mpv-http.sh"
fi

echo "--- S1 stremio-core ---"
if [[ ! -f /etc/mango/stremio-export.json ]]; then
  fail "missing /etc/mango/stremio-export.json (paste Stremio export)"
elif [[ -x scripts/phase-n1/spike-stremio-core.sh ]]; then
  bash scripts/phase-n1/spike-stremio-core.sh && pass "spike-stremio-core" || fail "spike-stremio-core"
else
  fail "missing scripts/phase-n1/spike-stremio-core.sh"
fi

echo "--- catalog-service ---"
if curl -sf --max-time 3 http://127.0.0.1:3020/health >/tmp/mango-n1-health.json 2>/dev/null; then
  pass "GET /health"
  curl -sf --max-time 30 "http://127.0.0.1:3020/meta/movie/${SMOKE_ID}" >/tmp/mango-n1-meta.json \
    && pass "GET /meta/movie/${SMOKE_ID}" || fail "GET /meta"
  curl -sf --max-time 60 "http://127.0.0.1:3020/stream/movie/${SMOKE_ID}" >/tmp/mango-n1-stream.json \
    && pass "GET /stream/movie/${SMOKE_ID}" || fail "GET /stream"
  curl -sf --max-time 90 -X POST http://127.0.0.1:3020/play \
    -H 'content-type: application/json' \
    -d "{\"type\":\"movie\",\"id\":\"${SMOKE_ID}\"}" >/tmp/mango-n1-play.json \
    && pass "POST /play" || fail "POST /play"
else
  fail "catalog-service :3020 not reachable (MANGO_CATALOG=1 + stack restart?)"
fi

echo "--- hygiene ---"
pgrep -x stremio >/dev/null && fail "stremio running at idle" || pass "stremio idle"
MPV_COUNT="$(pgrep -c -x mpv 2>/dev/null || true)"
MPV_COUNT="${MPV_COUNT:-0}"
[[ "${MPV_COUNT}" -le 1 ]] && pass "mpv count ${MPV_COUNT}" || fail "mpv count ${MPV_COUNT} > 1"

if [[ -x scripts/phase-n1/mpv-stop.sh ]]; then
  bash scripts/phase-n1/mpv-stop.sh && pass "mpv-stop" || fail "mpv-stop"
fi
MPV_AFTER_STOP="$(pgrep -c -x mpv 2>/dev/null || true)"
MPV_AFTER_STOP="${MPV_AFTER_STOP:-0}"
[[ "${MPV_AFTER_STOP}" -eq 0 ]] && pass "mpv stopped" || fail "mpv still running after stop (${MPV_AFTER_STOP})"

echo "--- N0 regression ---"
bash scripts/phase-n0/gate-n0.sh && pass "gate-n0" || fail "gate-n0 regression"

echo
if [[ "${ERRORS}" -eq 0 ]]; then
  echo "N1 gate: PASS"
  exit 0
fi
echo "N1 gate: FAIL (${ERRORS} errors)"
exit 1

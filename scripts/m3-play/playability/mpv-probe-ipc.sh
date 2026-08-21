#!/usr/bin/env bash
# Probe one debrid URL via a persistent mpv worker (maintenance only).
# usage: mpv-probe-ipc.sh --worker-id N --url URL [--timeout-ms N] [--min-duration-sec N] [--probe]

set -euo pipefail

SOCKET_DIR="${MANGO_MPV_PROBE_SOCKET_DIR:-${HOME}/.cache/mango/mpv-probe}"
LEASE_FILE="${MANGO_MPV_PROBE_LEASE_FILE:-${XDG_CACHE_HOME:-${HOME}/.cache}/mango/mpv-probe-pool.lock}"
COUCH_SOCKET="${MANGO_MPV_SOCKET:-${HOME}/.cache/mango/mpv.sock}"
COUCH_PID_FILE="${MANGO_MPV_PID_FILE:-${HOME}/.cache/mango/mpv.pid}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

WORKER_ID=""
URL=""
TIMEOUT_MS=12000
MIN_DURATION_SEC=600
MIN_DURATION_SET=false
PROBE=false
ORIGINAL_ARGS=("$@")

usage() {
  echo "usage: $0 --worker-id <n> --url <http-url> [--timeout-ms N] [--min-duration-sec N] [--probe]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker-id) WORKER_ID="${2:-}"; shift 2 ;;
    --url) URL="${2:-}"; shift 2 ;;
    --timeout-ms) TIMEOUT_MS="${2:-}"; shift 2 ;;
    --min-duration-sec) MIN_DURATION_SEC="${2:-}"; MIN_DURATION_SET=true; shift 2 ;;
    --probe) PROBE=true; shift ;;
    *) usage ;;
  esac
done

[[ -n "$WORKER_ID" && "$WORKER_ID" =~ ^[0-9]+$ ]] || usage
[[ -n "$URL" ]] || usage
[[ "$TIMEOUT_MS" =~ ^[0-9]+$ ]] || usage
[[ "$MIN_DURATION_SEC" =~ ^[0-9]+$ ]] || usage

# ElfHosted public instances return a short placeholder — never mpv-probe it.
if [[ "$URL" == *rate-limit-exceeded* || "$URL" == *public-rate-limit* ]]; then
  echo "FAIL: rate_limited stream URL" >&2
  exit 1
fi

# Hard wall-clock cap — kills hung socat/mpv orphans when Node's execFile timeout fires.
if [[ -z "${MANGO_PROBE_TIMEOUT_WRAPPER:-}" ]]; then
  export MANGO_PROBE_TIMEOUT_WRAPPER=1
  HARD_LIMIT_SEC=$(( (TIMEOUT_MS + 999) / 1000 + 8 ))
  exec timeout --kill-after=3 "$HARD_LIMIT_SEC" "$0" "${ORIGINAL_ARGS[@]}"
fi

# Catalog maintenance holds this lease across its full concurrent pool lifetime.
# Direct diagnostics acquire it for this single probe. The pathname is stable
# and must never be unlinked as crash cleanup; closing the fd releases flock.
if [[ "${MANGO_MPV_PROBE_LEASE_HELD:-0}" != "1" ]]; then
  exec python3 "$SCRIPT_DIR/../../lib/stable-flock-exec.py" \
    "$LEASE_FILE" MANGO_MPV_PROBE_LEASE_HELD "DEFERRED: mpv_probe_pool_owned" -- \
    bash "$0" "${ORIGINAL_ARGS[@]}"
fi

SOCKET="${SOCKET_DIR}/probe-${WORKER_ID}.sock"
POOL_SCRIPT="${SCRIPT_DIR}/mpv-probe-pool.sh"
REQUEST_ID=0

now_ms() {
  python3 -c 'import time; print(int(time.time()*1000))'
}

next_request_id() {
  REQUEST_ID=$((REQUEST_ID + 1))
  printf '%s' "$REQUEST_ID"
}

ipc_command() {
  local payload="$1"
  local reply=""
  if ! reply="$(printf '%s\n' "$payload" | socat -t 2 - "UNIX-CONNECT:${SOCKET}" 2>/dev/null)"; then
    return 1
  fi
  printf '%s' "$reply"
}

drain_events() {
  local drained=0
  while IFS= read -r -t 0.05 _line; do
    drained=$((drained + 1))
    if [[ $drained -gt 200 ]]; then
      break
    fi
  done < <(socat -u -t 0.2 "UNIX-CONNECT:${SOCKET}" STDOUT 2>/dev/null || true)
}

mpv_property() {
  local property="$1"
  local request_id reply
  request_id="$(next_request_id)"
  reply="$(ipc_command "{\"command\":[\"get_property\",\"${property}\"],\"request_id\":${request_id}}" || true)"
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("data") or 0)' <<<"$reply" 2>/dev/null || echo 0
}

foreground_playback_active() {
  local pid=""
  if [[ -f "$COUCH_PID_FILE" ]]; then
    pid="$(tr -dc '0-9' <"$COUCH_PID_FILE" 2>/dev/null || true)"
  fi
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && [[ -S "$COUCH_SOCKET" ]]
}

playback_is_real() {
  local playback_time="$1"
  local duration
  local min_duration="$MIN_DURATION_SEC"
  if $PROBE && ! $MIN_DURATION_SET; then
    min_duration=5
  fi
  duration="$(mpv_property duration)"
  python3 - "$playback_time" "$duration" "$min_duration" <<'PY'
import sys
playback = float(sys.argv[1] or 0)
duration = float(sys.argv[2] or 0)
min_duration = float(sys.argv[3] or 0)
if duration > 0 and duration < min_duration:
    raise SystemExit(2)
if duration <= 0 and playback < 3.0:
    raise SystemExit(1)
if duration > 0 and playback < 1.5:
    raise SystemExit(1)
raise SystemExit(0)
PY
}

restart_worker() {
  bash "$POOL_SCRIPT" restart-worker "$WORKER_ID" >/dev/null 2>&1 || true
}

if foreground_playback_active; then
  echo "DEFERRED: foreground_playback_active"
  exit 75
fi

bash "$POOL_SCRIPT" ensure --workers "$((WORKER_ID + 1))" >/dev/null
[[ -S "$SOCKET" ]] || { echo "FAIL: probe socket missing: $SOCKET" >&2; restart_worker; exit 1; }

drain_events || true
ipc_command '{"command":["disable_event","all"]}' >/dev/null 2>&1 || true

URL_JSON="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$URL")"
if ! ipc_command "{\"command\":[\"loadfile\",${URL_JSON},\"replace\"]}" >/dev/null 2>&1; then
  echo "FAIL: mpv loadfile rejected" >&2
  restart_worker
  exit 1
fi

START_MS="$(now_ms)"
DEADLINE_MS=$((START_MS + TIMEOUT_MS))

while [[ "$(now_ms)" -lt "$DEADLINE_MS" ]]; do
  if foreground_playback_active; then
    ipc_command '{"command":["stop"]}' >/dev/null 2>&1 || true
    echo "DEFERRED: foreground_playback_active"
    exit 75
  fi
  drain_events || true
  PT="$(mpv_property playback-time)"
  if python3 -c "import sys; sys.exit(0 if float('${PT:-0}') > 0 else 1)" 2>/dev/null; then
    if playback_is_real "${PT:-0}"; then
      END_MS="$(now_ms)"
      DUR="$(mpv_property duration)"
      echo "PASS: ttff_ms=$((END_MS - START_MS)) duration_sec=${DUR:-0}"
      ipc_command '{"command":["stop"]}' >/dev/null 2>&1 || true
      exit 0
    fi
    DUR="$(mpv_property duration)"
    min_duration="$MIN_DURATION_SEC"
    if $PROBE && ! $MIN_DURATION_SET; then
      min_duration=5
    fi
    if python3 -c "import sys; d=float('${DUR:-0}'); sys.exit(0 if d > 0 and d < float('${min_duration}') else 1)" 2>/dev/null; then
      echo "FAIL: debrid_status_clip duration=${DUR}" >&2
      restart_worker
      exit 1
    fi
  fi
  sleep 0.15
done

echo "FAIL: mpv did not start playback within ${TIMEOUT_MS}ms" >&2
restart_worker
exit 1

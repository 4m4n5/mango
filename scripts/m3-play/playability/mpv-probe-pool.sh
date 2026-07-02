#!/usr/bin/env bash
# Persistent headless mpv workers for maintenance playability probes.
# Usage:
#   mpv-probe-pool.sh ensure [--workers N]
#   mpv-probe-pool.sh restart-worker <id>
#   mpv-probe-pool.sh stop-all

set -euo pipefail

SOCKET_DIR="${MANGO_MPV_PROBE_SOCKET_DIR:-${HOME}/.cache/mango/mpv-probe}"
WORKERS="${MANGO_PLAYABILITY_PROBE_CONCURRENCY:-1}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

usage() {
  echo "usage: $0 ensure [--workers N] | restart-worker <id> | stop-all" >&2
  exit 2
}

detect_hwdec() {
  if [[ -n "${MANGO_MPV_HWDEC:-}" ]]; then
    printf '%s\n' "$MANGO_MPV_HWDEC"
    return
  fi
  if grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null; then
    printf '%s\n' "drm"
    return
  fi
  printf '%s\n' "auto-safe"
}

worker_socket() {
  printf '%s/probe-%s.sock\n' "$SOCKET_DIR" "$1"
}

worker_pid_file() {
  printf '%s/probe-%s.pid\n' "$SOCKET_DIR" "$1"
}

worker_alive() {
  local worker_id="$1"
  local pid_file
  pid_file="$(worker_pid_file "$worker_id")"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

ensure_worker() {
  local worker_id="$1"
  local socket pid_file hwdec
  socket="$(worker_socket "$worker_id")"
  pid_file="$(worker_pid_file "$worker_id")"
  mkdir -p "$SOCKET_DIR"

  if worker_alive "$worker_id" && [[ -S "$socket" ]]; then
    return 0
  fi

  rm -f "$socket"
  hwdec="$(detect_hwdec)"
  mpv \
    --idle=yes \
    --force-window=no \
    --keep-open=no \
    --no-terminal \
    --really-quiet \
    --profile=low-latency \
    --untimed \
    --hwdec="$hwdec" \
    --vo=null \
    --ao=null \
    --input-ipc-server="$socket" \
    >/dev/null 2>&1 &
  echo "$!" >"$pid_file"

  local tries=0
  while [[ $tries -lt 50 ]]; do
    [[ -S "$socket" ]] && return 0
    sleep 0.1
    tries=$((tries + 1))
  done
  echo "mpv-probe-pool: worker $worker_id failed to create socket $socket" >&2
  return 1
}

stop_worker() {
  local worker_id="$1"
  local socket pid_file pid
  socket="$(worker_socket "$worker_id")"
  pid_file="$(worker_pid_file "$worker_id")"
  if [[ -S "$socket" ]]; then
    echo '{"command":["quit"]}' | socat - "$socket" >/dev/null 2>&1 || true
    sleep 0.1
  fi
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      sleep 0.1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
  pkill -f "input-ipc-server=${socket}" 2>/dev/null || true
  rm -f "$socket"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  ensure)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --workers) WORKERS="${2:-}"; shift 2 ;;
        *) usage ;;
      esac
    done
    [[ "$WORKERS" =~ ^[0-9]+$ ]] && [[ "$WORKERS" -ge 1 ]] || usage
    for ((i = 0; i < WORKERS; i++)); do
      ensure_worker "$i"
    done
    ;;
  restart-worker)
    WORKER_ID="${1:-}"
    [[ -n "$WORKER_ID" && "$WORKER_ID" =~ ^[0-9]+$ ]] || usage
    stop_worker "$WORKER_ID"
    ensure_worker "$WORKER_ID"
    ;;
  stop-all)
    for pid_file in "$SOCKET_DIR"/probe-*.pid; do
      [[ -e "$pid_file" ]] || continue
      worker_id="$(basename "$pid_file" .pid)"
      worker_id="${worker_id#probe-}"
      stop_worker "$worker_id"
    done
    rm -f "$SOCKET_DIR"/probe-*.sock "$SOCKET_DIR"/probe-*.pid 2>/dev/null || true
    ;;
  *)
    usage
    ;;
esac

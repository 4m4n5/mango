#!/usr/bin/env bash
# Single daily entrypoint for the native mango base stack.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export MANGO_SKIP_OVERLAY=1
CACHE_DIR="${HOME}/.cache/mango"
CATALOG_PID="${CACHE_DIR}/catalog-service.pid"
CATALOG_LOG="${CACHE_DIR}/catalog-service.log"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi
export MANGO_SKIP_OVERLAY=1

usage() {
  echo "usage: $0 start|stop|status|restart" >&2
  exit 2
}

stop_idle_media() {
  bash scripts/phase-n1/mpv-stop.sh 2>/dev/null || true
  pkill -x stremio 2>/dev/null || true
  pkill -f '[s]tremio' 2>/dev/null || true
  pkill -x kodi 2>/dev/null || true
  pkill -f '[k]odi' 2>/dev/null || true
  pkill -f 'chromium.*mango-overlay.*127.0.0.1:3000/overlay/' 2>/dev/null || true
}

start_catalog_service() {
  [[ "${MANGO_CATALOG:-0}" == "1" ]] || return 0
  mkdir -p "$CACHE_DIR"
  if [[ ! -f src/catalog-service/dist/index.js ]]; then
    echo "catalog-service dist missing; run: cd src/catalog-service && npm ci && npm run build" >&2
    return 1
  fi
  if [[ -f "$CATALOG_PID" ]] && kill -0 "$(cat "$CATALOG_PID")" 2>/dev/null; then
    if curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
      echo "catalog-service already running"
      return 0
    fi
  fi
  rm -f "$CATALOG_PID"
  (
    cd src/catalog-service
    MANGO_REPO_DIR="$REPO_DIR" node dist/index.js
  ) >"$CATALOG_LOG" 2>&1 &
  echo $! >"$CATALOG_PID"

  for _ in $(seq 1 40); do
    if curl -sf --max-time 2 http://127.0.0.1:3020/health >/dev/null 2>&1; then
      echo "catalog-service ready (:3020)"
      return 0
    fi
    if ! kill -0 "$(cat "$CATALOG_PID")" 2>/dev/null; then
      echo "catalog-service exited; log: $CATALOG_LOG" >&2
      tail -40 "$CATALOG_LOG" >&2 || true
      return 1
    fi
    sleep 0.25
  done
  echo "catalog-service did not become healthy; log: $CATALOG_LOG" >&2
  tail -40 "$CATALOG_LOG" >&2 || true
  return 1
}

stop_catalog_service() {
  if [[ -f "$CATALOG_PID" ]]; then
    kill "$(cat "$CATALOG_PID")" 2>/dev/null || true
    sleep 0.3
    kill -9 "$(cat "$CATALOG_PID")" 2>/dev/null || true
    rm -f "$CATALOG_PID"
  fi
  pkill -f '[s]rc/catalog-service/dist/index.js' 2>/dev/null || true
}

start_stack() {
  stop_idle_media
  bash scripts/phase1/start-mango-ui.sh
  start_catalog_service
  if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
    bash scripts/phase2/start-voice-stack.sh
  fi
}

stop_stack() {
  stop_catalog_service
  bash scripts/phase-n1/mpv-stop.sh 2>/dev/null || true
  bash scripts/phase1/stop-mango-ui.sh 2>/dev/null || true
  if command -v tmux >/dev/null 2>&1; then
    tmux kill-session -t mango-orch 2>/dev/null || true
    tmux kill-session -t mango-companion 2>/dev/null || true
  fi
  stop_idle_media
}

status_stack() {
  echo "mango stack status"
  echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "voice: ${MANGO_VOICE:-0}"
  echo "catalog: ${MANGO_CATALOG:-0}"
  if curl -sf --max-time 2 http://127.0.0.1:3020/health >/tmp/mango-catalog-health.json 2>/dev/null; then
    echo "catalog health: $(cat /tmp/mango-catalog-health.json)"
  else
    echo "catalog health: down"
  fi
  echo
  bash scripts/diag/baseline-metrics.sh --label status --print-json
}

case "${1:-}" in
  start) start_stack ;;
  stop) stop_stack ;;
  restart)
    stop_stack
    start_stack
    ;;
  status) status_stack ;;
  *) usage ;;
esac

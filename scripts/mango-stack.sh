#!/usr/bin/env bash
# Single daily entrypoint for the native mango base stack.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export MANGO_SKIP_OVERLAY=1

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
  pkill -x stremio 2>/dev/null || true
  pkill -f '[s]tremio' 2>/dev/null || true
  pkill -x kodi 2>/dev/null || true
  pkill -f '[k]odi' 2>/dev/null || true
  pkill -f 'chromium.*mango-overlay.*127.0.0.1:3000/overlay/' 2>/dev/null || true
}

start_stack() {
  stop_idle_media
  bash scripts/phase1/start-mango-ui.sh
  if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
    bash scripts/phase2/start-voice-stack.sh
  fi
}

stop_stack() {
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

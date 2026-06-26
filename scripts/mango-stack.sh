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

if [[ -x scripts/audio/apply-saved-sink.sh ]]; then
  bash scripts/audio/apply-saved-sink.sh 2>/dev/null || true
fi

export MANGO_SKIP_OVERLAY=1

usage() {
  echo "usage: $0 start|stop|status|restart|refresh" >&2
  exit 2
}

stop_idle_media() {
  bash scripts/m2-catalog/service/mpv-stop.sh 2>/dev/null || true
  pkill -f 'playability-indexer' 2>/dev/null || true
  pkill -f 'tsx.*m3-play/playability' 2>/dev/null || true
  pkill -x stremio 2>/dev/null || true
  pkill -f '[s]tremio' 2>/dev/null || true
  pkill -x kodi 2>/dev/null || true
  pkill -f '[k]odi' 2>/dev/null || true
  pkill -f 'chromium.*mango-overlay.*127.0.0.1:3000/overlay/' 2>/dev/null || true
}

launcher_browser_running() {
  pgrep -f "chromium.*mango-launcher.*127.0.0.1:${MANGO_LAUNCHER_PORT:-3000}/|firefox.*127.0.0.1:${MANGO_LAUNCHER_PORT:-3000}/" >/dev/null 2>&1
}

stop_orphan_indexer() {
  pkill -f 'playability-indexer' 2>/dev/null || true
  pkill -f 'tsx.*m3-play/playability' 2>/dev/null || true
}

catalog_unit_enabled() {
  command -v systemctl >/dev/null 2>&1 \
    && systemctl --user is-enabled mango-catalog.service >/dev/null 2>&1
}

# shellcheck source=lib/catalog-yaml.sh
source "$REPO_DIR/scripts/lib/catalog-yaml.sh"
# shellcheck source=lib/catalog-service-stack.sh
source "$REPO_DIR/scripts/lib/catalog-service-stack.sh"

start_catalog_service() {
  [[ "${MANGO_CATALOG:-0}" == "1" ]] || return 0
  mkdir -p "$CACHE_DIR"
  if catalog_unit_enabled; then
    systemctl --user start mango-catalog.service || true
    for _ in $(seq 1 120); do
      if catalog_service_healthy; then
        catalog_service_recover_pid_file "$CATALOG_PID" >/dev/null 2>&1 || true
        echo "catalog-service ready (:$(catalog_service_port), systemd)"
        return 0
      fi
      sleep 0.5
    done
    echo "catalog-service systemd unit did not become healthy" >&2
    systemctl --user status mango-catalog.service --no-pager -l >&2 || true
    return 1
  fi
  if [[ ! -f src/catalog-service/dist/index.js ]]; then
    echo "catalog-service dist missing; run: cd src/catalog-service && npm ci && npm run build" >&2
    return 1
  fi
  local catalog_yaml catalog_filters
  catalog_yaml="$(resolve_catalog_yaml)" || return 1
  catalog_filters="$(resolve_catalog_filters)"
  if [[ -f "$CATALOG_PID" ]]; then
    if kill -0 "$(cat "$CATALOG_PID")" 2>/dev/null \
      && catalog_service_healthy; then
      echo "catalog-service already running"
      return 0
    fi
    rm -f "$CATALOG_PID"
  fi
  if catalog_service_recover_pid_file "$CATALOG_PID"; then
    return 0
  fi
  stop_orphan_indexer
  rm -f "$CATALOG_PID"
  catalog_service_kill_port_listener
  (
    cd "$REPO_DIR"
    exec setsid env \
      MANGO_REPO_DIR="$REPO_DIR" \
      MANGO_CATALOG_YAML="$catalog_yaml" \
      MANGO_CATALOG_FILTERS="$catalog_filters" \
      bash scripts/m2-catalog/service/run-catalog-service.sh
  ) </dev/null >"$CATALOG_LOG" 2>&1 &
  echo $! >"$CATALOG_PID"

  for _ in $(seq 1 120); do
    if catalog_service_healthy; then
      echo "catalog-service ready (:$(catalog_service_port))"
      return 0
    fi
    if ! kill -0 "$(cat "$CATALOG_PID")" 2>/dev/null; then
      echo "catalog-service exited; log: $CATALOG_LOG" >&2
      tail -40 "$CATALOG_LOG" >&2 || true
      return 1
    fi
    sleep 0.5
  done
  echo "catalog-service did not become healthy; log: $CATALOG_LOG" >&2
  tail -40 "$CATALOG_LOG" >&2 || true
  return 1
}

start_playability_topup() {
  [[ "${MANGO_CATALOG:-0}" == "1" ]] || return 0
  [[ "${MANGO_PLAYABILITY_TOPUP_ON_START:-0}" == "1" ]] || return 0
  mkdir -p "$CACHE_DIR"
  (
    cd "$REPO_DIR"
    nice -n 10 npm --prefix src/catalog-service exec tsx -- \
      scripts/m3-play/playability/playability-indexer.ts top-up --all
  ) >"${CACHE_DIR}/playability-indexer.log" 2>&1 &
  [[ "${MANGO_STACK_VERBOSE:-0}" == "1" ]] && echo "playability indexer background (log: ${CACHE_DIR}/playability-indexer.log)"
}

stop_catalog_service() {
  if catalog_unit_enabled; then
    systemctl --user stop mango-catalog.service 2>/dev/null || true
  fi
  if [[ -f "$CATALOG_PID" ]]; then
    kill "$(cat "$CATALOG_PID")" 2>/dev/null || true
    sleep 0.3
    kill -9 "$(cat "$CATALOG_PID")" 2>/dev/null || true
    rm -f "$CATALOG_PID"
  fi
  pkill -f '[s]rc/catalog-service/dist/index.js' 2>/dev/null || true
  pkill -f '[c]atalog-service/dist/index.js' 2>/dev/null || true
  catalog_service_kill_port_listener
}

start_stack() {
  bash "$REPO_DIR/scripts/mango-kill-strays.sh" 2>/dev/null || true
  bash "$REPO_DIR/scripts/lib/stop-input-remapper.sh" 2>/dev/null || true
  stop_idle_media
  start_catalog_service
  start_playability_topup
  bash scripts/m1-foundation/ui/start-mango-ui.sh
  if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
    bash scripts/m5-voice/stack/start-voice-stack.sh \
      || echo "voice stack: not ready (launcher+catalog ok)" >&2
  fi
  if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
    curl -sf --max-time 3 "$(catalog_service_url)/health" >/dev/null \
      || { echo "catalog-service unhealthy after start" >&2; return 1; }
  fi
  bash scripts/m1-foundation/pad/pad-health.sh --quiet --repair 2>/dev/null || true
}

stop_stack() {
  stop_orphan_indexer
  bash "$REPO_DIR/scripts/mango-kill-strays.sh" 2>/dev/null || true
  stop_catalog_service
  bash scripts/m2-catalog/service/mpv-stop.sh 2>/dev/null || true
  if systemctl --user is-enabled mango-orchestrator.service &>/dev/null 2>&1; then
    systemctl --user stop mango-companion.service mango-orchestrator.service 2>/dev/null || true
  fi
  if command -v tmux >/dev/null 2>&1; then
    tmux kill-session -t mango-orch 2>/dev/null || true
    tmux kill-session -t mango-companion 2>/dev/null || true
  fi
  bash scripts/m1-foundation/ui/stop-mango-ui.sh 2>/dev/null || true
  stop_idle_media
}

status_stack() {
  echo "mango: commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown) voice=${MANGO_VOICE:-0} catalog=${MANGO_CATALOG:-0}"
  if curl -sf --max-time 2 "$(catalog_service_url)/health" >/tmp/mango-catalog-health.json 2>/dev/null; then
    catalog_service_recover_pid_file "$CATALOG_PID" >/dev/null 2>&1 || true
    echo "catalog: $(tr -d '\n' </tmp/mango-catalog-health.json)"
  else
    rm -f "$CATALOG_PID"
    echo "catalog: down"
  fi
  curl -sf --max-time 2 "http://127.0.0.1:${MANGO_LAUNCHER_PORT:-3000}/api/health" >/dev/null 2>&1 \
    && echo "launcher: up" || echo "launcher: down"
  launcher_browser_running \
    && echo "launcher browser: up" || echo "launcher browser: down"
  if [[ -x scripts/m1-foundation/pad/pad-health.sh ]]; then
    if bash scripts/m1-foundation/pad/pad-health.sh --quiet; then
      echo "pad: ok"
    else
      echo "pad: unhealthy — bash scripts/m1-foundation/pad/pad-health.sh --repair"
    fi
  fi
  pgrep -f 'playability-indexer' >/dev/null 2>&1 \
    && echo "indexer: running (competes with mpv)" || true
  if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
    if curl -skf --max-time 2 https://127.0.0.1:8765/health >/dev/null 2>&1 \
      && ss -tlnp 2>/dev/null | grep -q '127.0.0.1:8766'; then
      echo "voice: up (:8765 WSS, :8766 HUD)"
    else
      echo "voice: down — bash scripts/m5-voice/stack/start-voice-stack.sh"
    fi
  else
    echo "voice: disabled"
  fi
}

case "${1:-}" in
  start) start_stack ;;
  stop) stop_stack ;;
  restart)
    stop_stack
    start_stack
    ;;
  refresh) exec bash "$REPO_DIR/scripts/mango-refresh.sh" ;;
  status) status_stack ;;
  *) usage ;;
esac

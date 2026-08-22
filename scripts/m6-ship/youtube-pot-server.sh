#!/usr/bin/env bash
# Local bgutil HTTP PO-token server for YouTube GVS (default :4416).
# yt-dlp's bgutil plugin prefers this over the per-invoke Deno script.
set -euo pipefail

DEST="${MANGO_BGUTIL_DIR:-$HOME/.local/share/mango/bgutil-pot}/server"
DENO_BIN="${MANGO_DENO:-$HOME/.local/share/mango/deno/bin/deno}"
PORT="${MANGO_BGUTIL_HTTP_PORT:-4416}"
PID_FILE="${MANGO_BGUTIL_HTTP_PID_FILE:-$HOME/.cache/mango/bgutil-pot-server.pid}"
LOG_FILE="${MANGO_BGUTIL_HTTP_LOG:-$HOME/.cache/mango/bgutil-pot-server.log}"
CACHE="$HOME/.cache/mango"

usage() {
  echo "usage: $0 start|stop|status" >&2
  exit 2
}

ping_ok() {
  curl -sf --max-time 1 "http://127.0.0.1:${PORT}/ping" >/dev/null 2>&1 \
    || curl -sf --max-time 1 "http://[::1]:${PORT}/ping" >/dev/null 2>&1
}

cmd="${1:-}"
[[ "$cmd" == "start" || "$cmd" == "stop" || "$cmd" == "status" ]] || usage

stop_server() {
  local pid=""
  if [[ -f "$PID_FILE" ]]; then
    pid="$(tr -dc '0-9' <"$PID_FILE" 2>/dev/null || true)"
    rm -f "$PID_FILE"
  fi
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 0.2
    kill -9 "$pid" 2>/dev/null || true
  fi
}

case "$cmd" in
  stop)
    stop_server
    exit 0
    ;;
  status)
    if ping_ok; then
      echo "youtube-pot-server: up (:${PORT})"
      exit 0
    fi
    echo "youtube-pot-server: down"
    exit 1
    ;;
esac

if ping_ok; then
  echo "youtube-pot-server: already up (:${PORT})"
  exit 0
fi

[[ -x "$DENO_BIN" ]] || {
  echo "youtube-pot-server: deno missing at $DENO_BIN" >&2
  exit 1
}
[[ -f "$DEST/src/main.ts" ]] || {
  echo "youtube-pot-server: bgutil server missing; run ensure-youtube-yt-dlp.sh" >&2
  exit 1
}
[[ -d "$DEST/node_modules" ]] || {
  echo "youtube-pot-server: node_modules missing in $DEST" >&2
  exit 1
}

mkdir -p "$CACHE"
# Deno FFI for canvas resolves relative to node_modules.
(
  cd "$DEST/node_modules"
  PATH="$(dirname "$DENO_BIN"):$PATH"
  # playability-maintenance lock fd; must never leak into detached Deno.
  exec 200>&- || true
  nohup "$DENO_BIN" run --allow-env --allow-net --allow-ffi=. --allow-read=. \
    ../src/main.ts --port "$PORT" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
)
for _ in $(seq 1 20); do
  if ping_ok; then
    echo "youtube-pot-server: up (:${PORT})"
    exit 0
  fi
  sleep 0.25
done
echo "youtube-pot-server: failed to listen on :${PORT}" >&2
exit 1

#!/usr/bin/env bash
# Start/stop catalog-service only (no launcher/chromium). Sourced by maintenance + mango-stack.

catalog_service_cache_dir() {
  echo "${XDG_CACHE_HOME:-$HOME/.cache}/mango"
}

catalog_service_port() {
  echo "${MANGO_CATALOG_PORT:-3020}"
}

catalog_service_url() {
  echo "http://127.0.0.1:$(catalog_service_port)"
}

catalog_service_port_pids() {
  local port
  port="$(catalog_service_port)"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NF'
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' | awk 'NF'
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p'
  fi
}

catalog_service_healthy() {
  curl -sf --max-time 2 "$(catalog_service_url)/health" >/dev/null 2>&1
}

catalog_service_recover_pid_file() {
  local pid_file="$1"
  local pid
  if ! catalog_service_healthy; then
    return 1
  fi
  pid="$(catalog_service_port_pids | head -n 1 || true)"
  if [[ -n "$pid" ]]; then
    echo "$pid" >"$pid_file"
    echo "catalog-service already running (pid $pid recovered)"
  else
    echo "catalog-service already running"
  fi
  return 0
}

catalog_service_kill_port_listener() {
  local pids pid
  pids="$(catalog_service_port_pids | sort -u || true)"
  [[ -n "$pids" ]] || return 0
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.3
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null || continue
    kill -9 "$pid" 2>/dev/null || true
  done
}

start_catalog_service_only() {
  local repo_dir="${MANGO_REPO_DIR:-$HOME/mango}"
  local cache_dir pid_file catalog_log
  cache_dir="$(catalog_service_cache_dir)"
  pid_file="${cache_dir}/catalog-service.pid"
  catalog_log="${cache_dir}/catalog-service.log"
  mkdir -p "$cache_dir"

  if [[ "${MANGO_CATALOG:-1}" != "1" ]]; then
    echo "catalog-service: MANGO_CATALOG=0 — skip start" >&2
    return 1
  fi
  if [[ ! -f "$repo_dir/src/catalog-service/dist/index.js" ]]; then
    echo "catalog-service dist missing" >&2
    return 1
  fi

  # shellcheck source=lib/catalog-yaml.sh
  source "$repo_dir/scripts/lib/catalog-yaml.sh"
  local catalog_yaml catalog_filters
  catalog_yaml="$(resolve_catalog_yaml)" || return 1
  catalog_filters="$(resolve_catalog_filters)"

  if [[ -f "$pid_file" ]]; then
    if kill -0 "$(cat "$pid_file")" 2>/dev/null \
      && catalog_service_healthy; then
      echo "catalog-service already running"
      return 0
    fi
    rm -f "$pid_file"
  fi
  if catalog_service_recover_pid_file "$pid_file"; then
    return 0
  fi

  pkill -f 'playability-indexer' 2>/dev/null || true
  pkill -f 'tsx.*m3-play/playability' 2>/dev/null || true
  catalog_service_kill_port_listener

  (
    cd "$repo_dir/src/catalog-service"
    MANGO_REPO_DIR="$repo_dir" MANGO_CATALOG_YAML="$catalog_yaml" MANGO_CATALOG_FILTERS="$catalog_filters" \
      node dist/index.js
  ) >"$catalog_log" 2>&1 &
  echo $! >"$pid_file"

  local i
  for i in $(seq 1 40); do
    if catalog_service_healthy; then
      echo "catalog-service ready (:$(catalog_service_port))"
      return 0
    fi
    if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "catalog-service exited; log: $catalog_log" >&2
      tail -20 "$catalog_log" >&2 || true
      return 1
    fi
    sleep 0.25
  done
  echo "catalog-service did not become healthy" >&2
  return 1
}

stop_catalog_service_only() {
  local cache_dir pid_file
  cache_dir="$(catalog_service_cache_dir)"
  pid_file="${cache_dir}/catalog-service.pid"
  if [[ -f "$pid_file" ]]; then
    kill "$(cat "$pid_file")" 2>/dev/null || true
    sleep 0.3
    kill -9 "$(cat "$pid_file")" 2>/dev/null || true
    rm -f "$pid_file"
  fi
  pkill -f '[c]atalog-service/dist/index.js' 2>/dev/null || true
  catalog_service_kill_port_listener
  sleep 0.5
}

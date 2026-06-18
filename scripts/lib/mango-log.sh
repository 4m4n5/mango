#!/usr/bin/env bash
# Append JSON lines to ~/.cache/mango/mango.log
# Usage: mango_log <event> [key=value ...]

mango_log() {
  local event="${1:?event required}"
  shift || true
  local log_dir="${HOME}/.cache/mango"
  local log_file="${log_dir}/mango.log"
  mkdir -p "$log_dir"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local json="{\"ts\":\"${ts}\",\"event\":\"${event}\""
  local kv k v
  for kv in "$@"; do
    k="${kv%%=*}"
    v="${kv#*=}"
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    json+=",\"${k}\":\"${v}\""
  done
  json+="}"
  printf '%s\n' "$json" >>"$log_file"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  mango_log "$@"
fi

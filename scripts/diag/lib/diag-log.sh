#!/usr/bin/env bash
# JSON lines for TV pad diagnostics — ~/.cache/mango/diag/sessions/<id>/events.jsonl

diag_session_dir() {
  if [[ -n "${MANGO_DIAG_SESSION:-}" && -d "${MANGO_DIAG_SESSION}" ]]; then
    printf '%s\n' "$MANGO_DIAG_SESSION"
    return 0
  fi
  local pointer="${HOME}/.cache/mango/diag/current_session"
  if [[ -f "$pointer" ]]; then
    local dir
    dir="$(tr -d '\n' <"$pointer")"
    if [[ -d "$dir" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
  fi
  return 1
}

diag_log() {
  local event="${1:?event required}"
  shift || true
  local dir
  dir="$(diag_session_dir)" || return 0
  local log_file="${dir}/events.jsonl"
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

diag_active() {
  diag_session_dir >/dev/null 2>&1
}

#!/usr/bin/env bash
# Shared gate helpers — source from phase gate scripts (do not execute directly).

mango_gate_init() {
  REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
  cd "$REPO_DIR"
  export DISPLAY="${DISPLAY:-:0}"
  export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
  if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
    # shellcheck disable=SC1091
    source "${HOME}/.config/mango/voice.env"
  fi
  export MANGO_SKIP_OVERLAY=1
  ERRORS=0
  WARNS=0
}

gate_pass() {
  [[ "${MANGO_GATE_QUIET:-0}" == "1" ]] || echo "PASS: $*"
}

gate_fail() {
  ERRORS=$((ERRORS + 1))
  [[ "${MANGO_GATE_QUIET:-0}" == "1" ]] || echo "FAIL: $*" >&2
}

gate_warn() {
  WARNS=$((WARNS + 1))
  [[ "${MANGO_GATE_QUIET:-0}" == "1" ]] || echo "WARN: $*" >&2
}

gate_header() {
  [[ "${MANGO_GATE_QUIET:-0}" == "1" ]] && return 0
  echo "========== $1 $(date -Iseconds) =========="
  echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo
}

gate_finish() {
  local label="${1:-gate}"
  if (( ERRORS > 0 )); then
    echo "${label}: FAIL (${ERRORS} errors, ${WARNS} warnings)" >&2
    return 1
  fi
  [[ "${MANGO_GATE_QUIET:-0}" == "1" ]] || echo "${label}: PASS (${WARNS} warnings)"
  return 0
}

gate_mpv_stop() {
  bash scripts/phase-n1/mpv-stop.sh >/dev/null 2>&1 || true
}

gate_check_mpv_playing() {
  local label="$1"
  for _ in $(seq 1 15); do
    local reply playback_time
    reply="$(bash scripts/phase-n1/mpv-ipc.sh get_property playback-time 2>/dev/null || true)"
    playback_time="$(printf '%s' "$reply" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("data") or 0)' 2>/dev/null || echo 0)"
    if python3 -c "import sys; sys.exit(0 if float('${playback_time:-0}') > 0 else 1)" 2>/dev/null; then
      gate_pass "$label mpv playing"
      return 0
    fi
    sleep 0.2
  done
  gate_fail "$label mpv playback-time > 0"
  return 1
}

gate_check_play_json() {
  python3 - "$1" "${2:-}" "${3:-}" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
max_total = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None
max_attempts = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
if data.get("ok") is not True:
    raise SystemExit("ok is not true")
ttff = int(data.get("ttff_ms") or 0)
total = int(data.get("total_ms") or 0)
attempts = int(data.get("attempts") or 0)
if ttff <= 0 or total <= 0 or attempts < 1:
    raise SystemExit(f"bad metrics ttff={ttff} total={total} attempts={attempts}")
if max_total is not None and total > max_total:
    raise SystemExit(f"total_ms {total} > {max_total}")
if max_attempts is not None and attempts > max_attempts:
    raise SystemExit(f"attempts {attempts} > {max_attempts}")
PY
}

gate_post_play() {
  local label="$1" type="$2" id="$3" out="$4" max_total="${5:-}" max_attempts="${6:-}" rail_id="${7:-}"
  local payload
  if [[ -n "$rail_id" ]]; then
    payload="{\"type\":\"${type}\",\"id\":\"${id}\",\"rail_id\":\"${rail_id}\"}"
  else
    payload="{\"type\":\"${type}\",\"id\":\"${id}\"}"
  fi
  if ! curl -sf --max-time 3 http://127.0.0.1:3020/health >/dev/null 2>&1; then
    gate_fail "$label catalog down"
    return 1
  fi
  if curl -sf --max-time 70 -X POST http://127.0.0.1:3020/play \
    -H 'content-type: application/json' \
    -d "$payload" >"$out" \
    && gate_check_play_json "$out" "$max_total" "$max_attempts" \
    && gate_check_mpv_playing "$label"; then
    gate_pass "$label play $id"
    return 0
  fi
  gate_fail "$label play $id"
  return 1
}

# Quick process hygiene (replaces baseline-metrics for routine gates).
gate_process_count() {
  local pattern="$1"
  local n
  n="$(pgrep -f "$pattern" 2>/dev/null | wc -l | tr -d '[:space:]')" || true
  echo "${n:-0}"
}

gate_idle_hygiene() {
  local chromium stremio kodi mem_mb
  chromium="$(gate_process_count 'chromium.*--app=')"
  stremio="$(gate_process_count 'stremio')"
  kodi="$(gate_process_count 'kodi')"
  mem_mb="$(awk '/^Mem:/ {print $7}' <(free -m 2>/dev/null) || echo 0)"
  [[ "${chromium:-0}" -le 1 ]] && gate_pass "chromium apps ${chromium}" || gate_fail "chromium apps ${chromium} > 1"
  [[ "${stremio:-0}" -eq 0 ]] && gate_pass "stremio idle" || gate_fail "stremio running at idle"
  [[ "${kodi:-0}" -eq 0 ]] && gate_pass "kodi idle" || gate_fail "kodi running at idle"
  if [[ "${mem_mb:-0}" -ge 2500 ]]; then
    gate_pass "mem available ${mem_mb} MB"
  else
    gate_fail "mem available ${mem_mb} MB < 2500"
  fi
}

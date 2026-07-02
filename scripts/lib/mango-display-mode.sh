#!/usr/bin/env bash
# Apply Mango couch display modes without changing stream selection policy.

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

LOG_DIR="${HOME}/.cache/mango"
LOG_FILE="${LOG_DIR}/display-mode.log"
mkdir -p "$LOG_DIR"

usage() {
  echo "usage: $0 launcher|playback|status" >&2
  exit 2
}

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*" >>"$LOG_FILE"
}

connected_output() {
  if [[ -n "${MANGO_DISPLAY_OUTPUT:-}" ]]; then
    printf '%s\n' "$MANGO_DISPLAY_OUTPUT"
    return
  fi
  xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}'
}

current_mode() {
  local output="$1"
  xrandr --query 2>/dev/null | awk -v out="$output" '
    $1 == out && $2 == "connected" {
      in_output=1
      for (i = 3; i <= NF; i++) {
        if ($i ~ /^[0-9]+x[0-9]+\+/) {
          split($i, current, "+")
          fallback=current[1]
        }
      }
      next
    }
    in_output && /^[A-Za-z0-9-]+ connected/ { exit }
    in_output && /\*/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /\*/) {
          rate=$i
          gsub(/[*+]/, "", rate)
          print $1 "@" rate
          printed=1
          exit
        }
      }
    }
    END { if (fallback && !printed) print fallback }
  '
}

mode_available() {
  local output="$1"
  local mode="$2"
  xrandr --query 2>/dev/null | awk -v out="$output" -v mode="$mode" '
    $1 == out && $2 == "connected" { in_output=1; next }
    in_output && /^[A-Za-z0-9-]+ connected/ { exit }
    in_output && $1 == mode { found=1 }
    END { exit found ? 0 : 1 }
  '
}

rate_available() {
  local output="$1"
  local mode="$2"
  local rate="$3"
  xrandr --query 2>/dev/null | awk -v out="$output" -v mode="$mode" -v rate="$rate" '
    $1 == out && $2 == "connected" { in_output=1; next }
    in_output && /^[A-Za-z0-9-]+ connected/ { exit }
    in_output && $1 == mode {
      for (i = 2; i <= NF; i++) {
        clean=$i
        gsub(/[*+]/, "", clean)
        if (int(clean + 0.5) == int(rate + 0.5)) found=1
      }
    }
    END { exit found ? 0 : 1 }
  '
}

apply_mode() {
  local label="$1"
  local mode="$2"
  local rate="$3"
  local output attempts attempt

  [[ "${MANGO_DISPLAY_MODE_DISABLE:-0}" != "1" ]] || {
    log "${label}: skipped disabled"
    return 0
  }
  command -v xrandr >/dev/null 2>&1 || {
    log "${label}: skipped missing xrandr"
    return 0
  }

  attempts="${MANGO_DISPLAY_MODE_ATTEMPTS:-}"
  if [[ -z "$attempts" ]]; then
    if [[ "$label" == "launcher" ]]; then
      attempts=8
    else
      attempts=1
    fi
  fi

  case "$mode" in
    "" | keep | off | none)
      output="$(connected_output)"
      log "${label}: keep output=${output} current=$(current_mode "$output")"
      return 0
      ;;
  esac

  for attempt in $(seq 1 "$attempts"); do
    output="$(connected_output)"
    if [[ -z "$output" ]]; then
      log "${label}: no connected output attempt=${attempt}/${attempts}"
      sleep 0.5
      continue
    fi

    if ! mode_available "$output" "$mode"; then
      log "${label}: unavailable output=${output} mode=${mode} current=$(current_mode "$output") attempt=${attempt}/${attempts}"
      sleep 0.5
      continue
    fi

    if [[ -n "$rate" ]] && rate_available "$output" "$mode" "$rate"; then
      if xrandr --output "$output" --mode "$mode" --rate "$rate" >/dev/null 2>&1; then
        log "${label}: applied output=${output} mode=${mode}@${rate} attempt=${attempt}/${attempts}"
        return 0
      fi
    fi

    if xrandr --output "$output" --mode "$mode" >/dev/null 2>&1; then
      log "${label}: applied output=${output} mode=${mode} current=$(current_mode "$output") attempt=${attempt}/${attempts}"
      return 0
    fi

    log "${label}: failed output=${output} mode=${mode}@${rate:-auto} current=$(current_mode "$output") attempt=${attempt}/${attempts}"
    sleep 0.5
  done

  log "${label}: gave up mode=${mode}@${rate:-auto}"
  return 0
}

cmd="${1:-}"
case "$cmd" in
  launcher)
    apply_mode \
      launcher \
      "${MANGO_LAUNCHER_DISPLAY_MODE:-${MANGO_DISPLAY_MODE:-1920x1080}}" \
      "${MANGO_LAUNCHER_DISPLAY_RATE:-${MANGO_DISPLAY_RATE:-60}}"
    ;;
  playback)
    apply_mode \
      playback \
      "${MANGO_MPV_DISPLAY_MODE:-${MANGO_PLAYBACK_DISPLAY_MODE:-keep}}" \
      "${MANGO_MPV_DISPLAY_RATE:-${MANGO_PLAYBACK_DISPLAY_RATE:-60}}"
    ;;
  status)
    if command -v xrandr >/dev/null 2>&1; then
      output="$(connected_output)"
      if [[ -n "${output:-}" ]]; then
        printf '%s %s\n' "$output" "$(current_mode "$output")"
      else
        echo "no connected output"
      fi
    else
      echo "xrandr unavailable"
    fi
    ;;
  *) usage ;;
esac

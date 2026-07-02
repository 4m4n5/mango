#!/usr/bin/env bash
# Apply Mango couch display modes without changing stream selection policy.

set -euo pipefail

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

LOG_DIR="${HOME}/.cache/mango"
LOG_FILE="${LOG_DIR}/display-mode.log"
mkdir -p "$LOG_DIR"

usage() {
  echo "usage: $0 launcher|playback|playback-auto <width> <height> <fps>|status" >&2
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

rates_for_mode() {
  local output="$1"
  local mode="$2"
  xrandr --query 2>/dev/null | awk -v out="$output" -v mode="$mode" '
    $1 == out && $2 == "connected" { in_output=1; next }
    in_output && /^[A-Za-z0-9-]+ connected/ { exit }
    in_output && $1 == mode {
      for (i = 2; i <= NF; i++) {
        clean=$i
        gsub(/[*+]/, "", clean)
        if (clean ~ /^[0-9]+(\.[0-9]+)?$/) print clean
      }
    }
  '
}

best_rate_for_fps() {
  local output="$1"
  local mode="$2"
  local fps="$3"
  local rates
  rates="$(rates_for_mode "$output" "$mode" | tr '\n' ' ')"
  [[ -n "$rates" && -n "$fps" ]] || return 1
  python3 - "$fps" "$rates" <<'PY'
import math
import sys

try:
    target = float(sys.argv[1])
except ValueError:
    raise SystemExit(1)

rates = []
for token in " ".join(sys.argv[2:]).split():
    try:
        rates.append((token, float(token)))
    except ValueError:
        pass

if target <= 0 or not rates:
    raise SystemExit(1)

best = None
for label, rate in rates:
    diff = abs(rate - target)
    score = None
    # Prefer exact film/TV refresh modes: 23.976 -> 23.98, 24 -> 24.00, etc.
    if diff <= 0.08:
        score = diff
    else:
        ratio = rate / target
        nearest = round(ratio)
        # Fall back to clean multiples only when no direct mode exists.
        if 2 <= nearest <= 5 and abs(ratio - nearest) <= 0.015:
            score = 10 + abs(ratio - nearest) + nearest / 100.0
    if score is None:
        continue
    if best is None or score < best[0]:
        best = (score, label)

if best is None:
    raise SystemExit(1)
print(best[1])
PY
}

playback_auto_modes() {
  local width="$1"
  local height="$2"
  local mode_4k="${MANGO_MPV_MATCH_4K_MODE:-3840x2160}"
  local mode_hd="${MANGO_MPV_MATCH_HD_MODE:-1920x1080}"
  if [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] \
    && { [[ "$width" -ge 3000 ]] || [[ "$height" -ge 1600 ]]; }; then
    printf '%s\n%s\n' "$mode_4k" "$mode_hd"
  else
    printf '%s\n%s\n' "$mode_hd" "$mode_4k"
  fi
}

apply_playback_auto() {
  local width="$1"
  local height="$2"
  local fps="$3"
  local output mode rate

  if [[ "${MANGO_MPV_MATCH_REFRESH:-1}" == "0" ]]; then
    log "playback-auto: disabled source=${width}x${height}@${fps}"
    apply_mode \
      playback \
      "${MANGO_MPV_DISPLAY_MODE:-${MANGO_PLAYBACK_DISPLAY_MODE:-keep}}" \
      "${MANGO_MPV_DISPLAY_RATE:-${MANGO_PLAYBACK_DISPLAY_RATE:-60}}" \
      "${MANGO_MPV_DISPLAY_RATE_STRICT:-1}" \
      "${MANGO_MPV_DISPLAY_FALLBACK_MODE:-${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}}" \
      "${MANGO_MPV_DISPLAY_FALLBACK_RATE:-${MANGO_LAUNCHER_DISPLAY_RATE:-60}}"
    return 0
  fi

  output="$(connected_output)"
  if [[ -z "${output:-}" || -z "${fps:-}" || "$fps" == "0" ]]; then
    log "playback-auto: missing data output=${output:-none} source=${width}x${height}@${fps:-unknown}"
    apply_mode \
      playback \
      "${MANGO_MPV_DISPLAY_MODE:-${MANGO_PLAYBACK_DISPLAY_MODE:-keep}}" \
      "${MANGO_MPV_DISPLAY_RATE:-${MANGO_PLAYBACK_DISPLAY_RATE:-60}}" \
      "${MANGO_MPV_DISPLAY_RATE_STRICT:-1}" \
      "${MANGO_MPV_DISPLAY_FALLBACK_MODE:-${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}}" \
      "${MANGO_MPV_DISPLAY_FALLBACK_RATE:-${MANGO_LAUNCHER_DISPLAY_RATE:-60}}"
    return 0
  fi

  while IFS= read -r mode; do
    [[ -n "$mode" ]] || continue
    mode_available "$output" "$mode" || continue
    rate="$(best_rate_for_fps "$output" "$mode" "$fps" 2>/dev/null || true)"
    [[ -n "$rate" ]] || continue
    log "playback-auto: matched source=${width}x${height}@${fps} output=${output} mode=${mode}@${rate}"
    apply_mode \
      playback-match \
      "$mode" \
      "$rate" \
      "1" \
      "${MANGO_MPV_DISPLAY_FALLBACK_MODE:-${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}}" \
      "${MANGO_MPV_DISPLAY_FALLBACK_RATE:-${MANGO_LAUNCHER_DISPLAY_RATE:-60}}"
    return 0
  done < <(playback_auto_modes "$width" "$height")

  log "playback-auto: no matched mode source=${width}x${height}@${fps} output=${output} fallback=${MANGO_MPV_DISPLAY_FALLBACK_MODE:-${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}}@${MANGO_MPV_DISPLAY_FALLBACK_RATE:-${MANGO_LAUNCHER_DISPLAY_RATE:-60}}"
  apply_mode \
    playback-fallback \
    "${MANGO_MPV_DISPLAY_FALLBACK_MODE:-${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}}" \
    "${MANGO_MPV_DISPLAY_FALLBACK_RATE:-${MANGO_LAUNCHER_DISPLAY_RATE:-60}}" \
    "0" \
    "" \
    ""
}

apply_mode() {
  local label="$1"
  local mode="$2"
  local rate="$3"
  local strict_rate="${4:-0}"
  local fallback_mode="${5:-}"
  local fallback_rate="${6:-}"
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

    if [[ -n "$rate" && "$strict_rate" == "1" ]]; then
      log "${label}: rate unavailable output=${output} mode=${mode}@${rate} current=$(current_mode "$output") attempt=${attempt}/${attempts}"
      sleep 0.5
      continue
    fi

    if xrandr --output "$output" --mode "$mode" >/dev/null 2>&1; then
      log "${label}: applied output=${output} mode=${mode} current=$(current_mode "$output") attempt=${attempt}/${attempts}"
      return 0
    fi

    log "${label}: failed output=${output} mode=${mode}@${rate:-auto} current=$(current_mode "$output") attempt=${attempt}/${attempts}"
    sleep 0.5
  done

  log "${label}: gave up mode=${mode}@${rate:-auto}"
  if [[ -n "$fallback_mode" ]]; then
    log "${label}: applying fallback mode=${fallback_mode}@${fallback_rate:-auto}"
    apply_mode "${label}-fallback" "$fallback_mode" "$fallback_rate" "0" "" ""
    return 0
  fi
  return 0
}

cmd="${1:-}"
case "$cmd" in
  launcher)
    apply_mode \
      launcher \
      "${MANGO_LAUNCHER_DISPLAY_MODE:-${MANGO_DISPLAY_MODE:-1920x1080}}" \
      "${MANGO_LAUNCHER_DISPLAY_RATE:-${MANGO_DISPLAY_RATE:-60}}" \
      "0" \
      "" \
      ""
    ;;
  playback)
    apply_mode \
      playback \
      "${MANGO_MPV_DISPLAY_MODE:-${MANGO_PLAYBACK_DISPLAY_MODE:-keep}}" \
      "${MANGO_MPV_DISPLAY_RATE:-${MANGO_PLAYBACK_DISPLAY_RATE:-60}}" \
      "${MANGO_MPV_DISPLAY_RATE_STRICT:-1}" \
      "${MANGO_MPV_DISPLAY_FALLBACK_MODE:-${MANGO_LAUNCHER_DISPLAY_MODE:-1920x1080}}" \
      "${MANGO_MPV_DISPLAY_FALLBACK_RATE:-${MANGO_LAUNCHER_DISPLAY_RATE:-60}}"
    ;;
  playback-auto)
    [[ $# -eq 4 ]] || usage
    apply_playback_auto "$2" "$3" "$4"
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

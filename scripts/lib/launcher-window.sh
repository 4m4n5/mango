#!/usr/bin/env bash
# Resolve the real Mango launcher X11 window, not helper/browser side windows.

launcher_browser_pattern() {
  local port="${MANGO_LAUNCHER_PORT:-3000}"
  printf '%s' "chromium.*--class=mango-launcher.*127.0.0.1:${port}/|firefox.*127.0.0.1:${port}/"
}

launcher_browser_pids() {
  pgrep -f "$(launcher_browser_pattern)" 2>/dev/null || true
}

launcher_window_pid() {
  xdotool getwindowpid "$1" 2>/dev/null || true
}

launcher_window_name() {
  xdotool getwindowname "$1" 2>/dev/null | tr '[:upper:]' '[:lower:]'
}

launcher_window_class_blob() {
  xprop -id "$1" WM_CLASS 2>/dev/null | tr '[:upper:]' '[:lower:]'
}

launcher_window_cmdline() {
  local pid
  pid="$(launcher_window_pid "$1")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  ps -p "$pid" -o args= 2>/dev/null | tr '[:upper:]' '[:lower:]'
}

launcher_window_xwininfo() {
  xwininfo -id "$1" 2>/dev/null || true
}

launcher_window_is_viewable() {
  launcher_window_xwininfo "$1" | grep -q 'Map State: IsViewable'
}

launcher_window_is_input_output() {
  launcher_window_xwininfo "$1" | grep -q 'Class: InputOutput'
}

launcher_window_area() {
  local width height
  width=0
  height=0
  while IFS='=' read -r key value; do
    case "$key" in
      WIDTH) width="${value:-0}" ;;
      HEIGHT) height="${value:-0}" ;;
    esac
  done < <(xdotool getwindowgeometry --shell "$1" 2>/dev/null || true)
  printf '%s\n' $((width * height))
}

launcher_window_is_match() {
  local wid="$1"
  local name class_blob cmdline port

  port="${MANGO_LAUNCHER_PORT:-3000}"
  name="$(launcher_window_name "$wid")"
  class_blob="$(launcher_window_class_blob "$wid")"
  cmdline="$(launcher_window_cmdline "$wid")"

  [[ -n "$cmdline" ]] || return 1
  [[ "$cmdline" == *"127.0.0.1:${port}/"* ]] || return 1
  [[ "$cmdline" == *"chromium"* || "$cmdline" == *"firefox"* ]] || return 1
  [[ "$cmdline" != *"/overlay/"* ]] || return 1
  [[ "$class_blob" != *"mango-overlay"* ]] || return 1
  [[ "$name" != *"selection owner"* ]] || return 1
  [[ "$name" != *"tooltip"* ]] || return 1
  launcher_window_is_viewable "$wid" || return 1
  launcher_window_is_input_output "$wid" || return 1

  if [[ "$class_blob" == *"mango-launcher"* ]]; then
    return 0
  fi

  [[ "$class_blob" == *"navigator"* || "$class_blob" == *"firefox"* ]]
}

find_launcher_wid() {
  local best_wid best_area wid pid area
  best_wid=""
  best_area=0

  command -v xdotool >/dev/null 2>&1 || return 1

  for pid in $(launcher_browser_pids); do
    while IFS= read -r wid; do
      [[ -n "$wid" ]] || continue
      launcher_window_is_match "$wid" || continue
      area="$(launcher_window_area "$wid")"
      if (( area > best_area )); then
        best_area="$area"
        best_wid="$wid"
      fi
    done < <(xdotool search --pid "$pid" 2>/dev/null || true)
  done

  if [[ -n "$best_wid" ]]; then
    printf '%s\n' "$best_wid"
    return 0
  fi

  while IFS= read -r wid; do
    [[ -n "$wid" ]] || continue
    launcher_window_is_match "$wid" || continue
    area="$(launcher_window_area "$wid")"
    if (( area > best_area )); then
      best_area="$area"
      best_wid="$wid"
    fi
  done < <(
    {
      xdotool search --class mango-launcher 2>/dev/null || true
      xdotool search --class firefox 2>/dev/null || true
    } | awk '!seen[$0]++'
  )

  [[ -n "$best_wid" ]] || return 1
  printf '%s\n' "$best_wid"
}

active_window_is_launcher() {
  local wid
  wid="$(xdotool getactivewindow 2>/dev/null || true)"
  [[ -n "$wid" && "$wid" != "0" ]] || return 1
  launcher_window_is_match "$wid"
}

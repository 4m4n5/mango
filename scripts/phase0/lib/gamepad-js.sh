#!/usr/bin/env bash
# Hide Pro Controller joystick nodes so Qt/Stremio cannot read native gamepad
# (evdev grab on event* does not block /dev/input/js*). Kodi disables joysticks in settings.

HIDDEN_JS_LIST="${HOME}/.cache/mango/hidden-js-devices"

hide_pro_controller_js() {
  mkdir -p "$(dirname "$HIDDEN_JS_LIST")"
  : >"$HIDDEN_JS_LIST"
  local js base sysname name
  for js in /dev/input/js*; do
    [[ -e "$js" ]] || continue
    base=$(basename "$js")
    sysname=$(readlink -f "/sys/class/input/${base}/device" 2>/dev/null || true)
    [[ -n "$sysname" && -f "${sysname}/name" ]] || continue
    name=$(tr -d '\n' <"${sysname}/name")
    if [[ "$name" == "Pro Controller" ]]; then
      sudo chmod 000 "$js"
      echo "$js" >>"$HIDDEN_JS_LIST"
      echo "  hid native joystick $js (Stremio uses keyboard bridge only)"
    fi
  done
}

restore_hidden_js() {
  [[ -f "$HIDDEN_JS_LIST" ]] || return 0
  sudo -n true 2>/dev/null || return 0
  local js
  while read -r js; do
    [[ -n "$js" && -e "$js" ]] && sudo -n chmod 660 "$js" 2>/dev/null || true
  done <"$HIDDEN_JS_LIST"
  rm -f "$HIDDEN_JS_LIST"
}

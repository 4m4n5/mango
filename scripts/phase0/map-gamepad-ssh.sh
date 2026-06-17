#!/usr/bin/env bash
# Map gamepad → TV keys over SSH (no GUI). Works with 8BitDo (BT) or keyboard-mode pads.
# Run on the Pi:
#   bash scripts/phase0/map-gamepad-ssh.sh
#   bash scripts/phase0/map-gamepad-ssh.sh --device /dev/input/event6 --name "8BitDo Pro 2"
#   bash scripts/phase0/map-gamepad-ssh.sh --buttons-only   # A/B only, keep existing D-pad preset

set -euo pipefail

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
PRESET_NAME="mango-tv"
BUTTONS_ONLY=false
EVENT_DEV=""
DEVICE_NAME=""
CAPTURE_RESULT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) EVENT_DEV="$2"; shift 2 ;;
    --name) DEVICE_NAME="$2"; shift 2 ;;
    --buttons-only) BUTTONS_ONLY=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

find_gamepad_event() {
  local path name
  for path in /dev/input/event*; do
    [[ -e "$path" ]] || continue
    name=$(cat "/sys/class/input/$(basename "$path")/device/name" 2>/dev/null || true)
    [[ "$name" == *FastPad* || "$name" == *fastpad* ]] && continue
    if echo "$name" | grep -qiE '8bitdo|8bit|pro 2|gamepad|controller'; then
      echo "$path"
      return 0
    fi
  done
  for path in /dev/input/event*; do
    [[ -e "$path" ]] || continue
    name=$(cat "/sys/class/input/$(basename "$path")/device/name" 2>/dev/null || true)
    [[ "$name" == *FastPad* ]] && continue
    if grep -qE 'js|gamepad|controller|8bit' <<<"$name" 2>/dev/null; then
      echo "$path"
      return 0
    fi
  done
  return 1
}

parse_ev_key_code() {
  local line=$1
  [[ "$line" == *"EV_KEY"* && "$line" == *"value 1"* ]] || return 1
  sed -n 's/.*code \([0-9][0-9]*\) (.*/\1/p' <<<"$line"
}

capture_key_code() {
  local device=$1 label=$2
  local line code

  echo >&2
  echo ">>> Press: $label (once), then release" >&2
  while read -r line; do
    code=$(parse_ev_key_code "$line" || true)
    if [[ -n "$code" ]]; then
      echo "    captured code $code" >&2
      CAPTURE_RESULT="$code"
      return 0
    fi
  done < <(sudo evtest "$device" 2>&1)
}

write_preset() {
  local device_name=$1 up=$2 down=$3 left=$4 right=$5 confirm=$6 back=$7
  local preset_dir="${CONFIG_ROOT}/presets/${device_name}"
  local preset_file="${preset_dir}/${PRESET_NAME}.json"
  mkdir -p "$preset_dir"
  cat >"$preset_file" <<EOF
[
  {"input_combination": [{"type": 1, "code": ${up}}], "target_uinput": "keyboard", "output_symbol": "Up"},
  {"input_combination": [{"type": 1, "code": ${down}}], "target_uinput": "keyboard", "output_symbol": "Down"},
  {"input_combination": [{"type": 1, "code": ${left}}], "target_uinput": "keyboard", "output_symbol": "Left"},
  {"input_combination": [{"type": 1, "code": ${right}}], "target_uinput": "keyboard", "output_symbol": "Right"},
  {"input_combination": [{"type": 1, "code": ${confirm}}], "target_uinput": "keyboard", "output_symbol": "Return"},
  {"input_combination": [{"type": 1, "code": ${back}}], "target_uinput": "keyboard", "output_symbol": "Esc"}
]
EOF
  echo "Wrote $preset_file"
}

append_buttons() {
  local device_name=$1 confirm=$2 back=$3
  local preset_file="${CONFIG_ROOT}/presets/${device_name}/${PRESET_NAME}.json"
  python3 - "$preset_file" "$confirm" "$back" <<'PY'
import json, sys
path, confirm, back = sys.argv[1:4]
with open(path) as f:
    mappings = json.load(f)
mappings.extend([
    {"input_combination": [{"type": 1, "code": int(confirm)}], "target_uinput": "keyboard", "output_symbol": "Return"},
    {"input_combination": [{"type": 1, "code": int(back)}], "target_uinput": "keyboard", "output_symbol": "Esc"},
])
with open(path, "w") as f:
    json.dump(mappings, f, indent=2)
    f.write("\n")
print(f"Appended A/B to {path}")
PY
}

write_hat_preset() {
  local device_name=$1 confirm=$2 back=$3
  local preset_dir="${CONFIG_ROOT}/presets/${device_name}"
  local preset_file="${preset_dir}/${PRESET_NAME}.json"
  mkdir -p "$preset_dir"
  cat >"$preset_file" <<EOF
[
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": -50}], "target_uinput": "keyboard", "output_symbol": "Up"},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": 50}], "target_uinput": "keyboard", "output_symbol": "Down"},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": -50}], "target_uinput": "keyboard", "output_symbol": "Left"},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": 50}], "target_uinput": "keyboard", "output_symbol": "Right"},
  {"input_combination": [{"type": 1, "code": ${confirm}}], "target_uinput": "keyboard", "output_symbol": "Return"},
  {"input_combination": [{"type": 1, "code": ${back}}], "target_uinput": "keyboard", "output_symbol": "Esc"}
]
EOF
  echo "Wrote hat + buttons preset: $preset_file"
}

write_autoload() {
  local device_name=$1
  python3 - "$CONFIG_ROOT/config.json" "$device_name" "$PRESET_NAME" <<'PY'
import json, os, sys
path, device, preset = sys.argv[1:4]
cfg = {"version": "2.2.1", "autoload": {}}
if os.path.isfile(path):
    with open(path) as f:
        cfg = json.load(f)
cfg.setdefault("autoload", {})[device] = preset
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(cfg, f, indent=4)
    f.write("\n")
print(f"Autoload: {device} -> {preset}")
PY
}

apply_preset() {
  local device_name=$1
  sudo systemctl start input-remapper 2>/dev/null || sudo input-remapper-service &
  sleep 1
  sudo input-remapper-control --command start-reader-service -d 2>/dev/null || true
  input-remapper-control --command start --device "$device_name" --preset "$PRESET_NAME"
  echo "Preset applied. Test D-pad on the TV desktop."
}

echo "=== mango: SSH gamepad mapper (no GUI) ==="
echo

if ! command -v evtest &>/dev/null; then
  sudo apt install -y evtest python3
fi

echo "sudo required for evtest — enter password if prompted:"
sudo -v

if [[ -z "$EVENT_DEV" ]]; then
  EVENT_DEV=$(find_gamepad_event) || {
    echo "No gamepad found. Pair 8BitDo: bash scripts/phase0/setup-8bitdo-bt.sh"
    exit 1
  }
fi
echo "Device: $EVENT_DEV"

if [[ -z "$DEVICE_NAME" ]]; then
  DEVICE_NAME=$(sudo input-remapper-control --list-devices 2>/dev/null | tr -d '"' | grep -vi fastpad | grep -iE '8bitdo|8bit|pro|gamepad|controller' | head -1 || true)
fi
if [[ -z "$DEVICE_NAME" ]]; then
  DEVICE_NAME=$(cat "/sys/class/input/$(basename "$EVENT_DEV")/device/name")
fi
echo "input-remapper name: $DEVICE_NAME"
echo

if $BUTTONS_ONLY; then
  capture_key_code "$EVENT_DEV" "A / confirm"; CONFIRM="$CAPTURE_RESULT"
  capture_key_code "$EVENT_DEV" "B / back"; BACK="$CAPTURE_RESULT"
  append_buttons "$DEVICE_NAME" "$CONFIRM" "$BACK"
else
  echo "Press six buttons when prompted (one at a time). Ctrl+C to restart."
  capture_key_code "$EVENT_DEV" "D-pad UP"; UP="$CAPTURE_RESULT"
  capture_key_code "$EVENT_DEV" "D-pad DOWN"; DOWN="$CAPTURE_RESULT"
  capture_key_code "$EVENT_DEV" "D-pad LEFT"; LEFT="$CAPTURE_RESULT"
  capture_key_code "$EVENT_DEV" "D-pad RIGHT"; RIGHT="$CAPTURE_RESULT"
  capture_key_code "$EVENT_DEV" "A / confirm"; CONFIRM="$CAPTURE_RESULT"
  capture_key_code "$EVENT_DEV" "B / back"; BACK="$CAPTURE_RESULT"
  write_preset "$DEVICE_NAME" "$UP" "$DOWN" "$LEFT" "$RIGHT" "$CONFIRM" "$BACK"
fi

write_autoload "$DEVICE_NAME"
apply_preset "$DEVICE_NAME"

echo
echo "Done. Reboot-safe autoload is set in ${CONFIG_ROOT}/config.json"

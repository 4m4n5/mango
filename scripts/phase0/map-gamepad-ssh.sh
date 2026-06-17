#!/usr/bin/env bash
# Map a keyboard-mode gamepad entirely over SSH (no mouse / GUI).
# Run on the Pi: bash scripts/phase0/map-gamepad-ssh.sh

set -euo pipefail

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
PRESET_NAME="mango-tv"
DEVICE_NAME=""

find_fastpad_event() {
  local path name
  for path in /dev/input/event*; do
    [[ -e "$path" ]] || continue
    name=$(cat "/sys/class/input/$(basename "$path")/device/name" 2>/dev/null || true)
    if [[ "$name" == *FastPad* ]] || [[ "$name" == *fastpad* ]]; then
      echo "$path"
      return 0
    fi
  done
  return 1
}

capture_key_code() {
  local device=$1 label=$2
  local line code
  local re='type 1 \(EV_KEY\), code ([0-9]+) \(KEY_[^)]+\), value 1'

  echo
  echo ">>> Press: $label (once), then release"
  while read -r line; do
    if [[ "$line" =~ $re ]]; then
      code="${BASH_REMATCH[1]}"
      echo "    captured code $code"
      echo "$code"
      return 0
    fi
  done < <(sudo evtest "$device" 2>&1)
}

write_preset() {
  local device_name=$1
  local up=$2 down=$3 left=$4 right=$5 confirm=$6 back=$7
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

EVENT_DEV=$(find_fastpad_event) || {
  echo "FastPad not found. Plug dongle and retry."
  exit 1
}
echo "Device: $EVENT_DEV"

DEVICE_NAME=$(sudo input-remapper-control --list-devices 2>/dev/null | grep -i fastpad | head -1 | tr -d '"') || true
if [[ -z "$DEVICE_NAME" ]]; then
  DEVICE_NAME=$(cat "/sys/class/input/$(basename "$EVENT_DEV")/device/name")
fi
echo "input-remapper name: $DEVICE_NAME"
echo
echo "You will press six buttons once each. Wrong press? Ctrl+C and restart."

UP=$(capture_key_code "$EVENT_DEV" "D-pad UP")
DOWN=$(capture_key_code "$EVENT_DEV" "D-pad DOWN")
LEFT=$(capture_key_code "$EVENT_DEV" "D-pad LEFT")
RIGHT=$(capture_key_code "$EVENT_DEV" "D-pad RIGHT")
CONFIRM=$(capture_key_code "$EVENT_DEV" "A / confirm")
BACK=$(capture_key_code "$EVENT_DEV" "B / back")

write_preset "$DEVICE_NAME" "$UP" "$DOWN" "$LEFT" "$RIGHT" "$CONFIRM" "$BACK"
write_autoload "$DEVICE_NAME"
apply_preset "$DEVICE_NAME"

echo
echo "Done. Reboot-safe autoload is set in ${CONFIG_ROOT}/config.json"

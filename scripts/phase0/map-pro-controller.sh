#!/usr/bin/env bash
# 8BitDo Micro (Switch BT → "Pro Controller") → keyboard for Kodi/Stremio.
#
# Verified on mango (Jun 2026) — face layout clockwise from left: Y · X · A · B
#   D-pad → arrows   B (bottom, evdev 304) → select   Y (left, evdev 308) → in-app back
#   −/+ center row unused for home; right button below them (316, alt 311) → home
#
# D-pad shows as ABS_X/ABS_Y (codes 0/1) in Switch mode — not hat axes.
# input-remapper rejects analog_threshold ±100 (max is ±99) — use ±80.
#
# Run on the Pi: bash scripts/phase0/map-pro-controller.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/irctl.sh
source "$SCRIPT_DIR/lib/irctl.sh"

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
DEVICE_NAME="Pro Controller"
PRESET_NAME="mango-tv"
PRESET_DIR="${CONFIG_ROOT}/presets/${DEVICE_NAME}"
PRESET_FILE="${PRESET_DIR}/${PRESET_NAME}.json"

mkdir -p "$PRESET_DIR"

cat >"$PRESET_FILE" <<'EOF'
[
  {"input_combination": [{"type": 3, "code": 0, "analog_threshold": -80}], "target_uinput": "keyboard", "output_symbol": "Left", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 0, "analog_threshold": 80}], "target_uinput": "keyboard", "output_symbol": "Right", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 1, "analog_threshold": -80}], "target_uinput": "keyboard", "output_symbol": "Up", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 1, "analog_threshold": 80}], "target_uinput": "keyboard", "output_symbol": "Down", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": -80}], "target_uinput": "keyboard", "output_symbol": "Left", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": 80}], "target_uinput": "keyboard", "output_symbol": "Right", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": -80}], "target_uinput": "keyboard", "output_symbol": "Up", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": 80}], "target_uinput": "keyboard", "output_symbol": "Down", "release_combination_keys": true},
  {"input_combination": [{"type": 1, "code": 544}], "target_uinput": "keyboard", "output_symbol": "Up"},
  {"input_combination": [{"type": 1, "code": 545}], "target_uinput": "keyboard", "output_symbol": "Down"},
  {"input_combination": [{"type": 1, "code": 546}], "target_uinput": "keyboard", "output_symbol": "Left"},
  {"input_combination": [{"type": 1, "code": 547}], "target_uinput": "keyboard", "output_symbol": "Right"},
  {"input_combination": [{"type": 1, "code": 304}], "target_uinput": "keyboard", "output_symbol": "Return"},
  {"input_combination": [{"type": 1, "code": 308}], "target_uinput": "keyboard", "output_symbol": "BackSpace"},
  {"input_combination": [{"type": 1, "code": 316}], "target_uinput": "keyboard", "output_symbol": "key(Super_L+h)"},
  {"input_combination": [{"type": 1, "code": 311}], "target_uinput": "keyboard", "output_symbol": "key(Super_L+h)"}
]
EOF

python3 - "$CONFIG_ROOT/config.json" "$DEVICE_NAME" "$PRESET_NAME" <<'PY'
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

ir_start_with_autoload "$DEVICE_NAME" "$PRESET_NAME"
echo "  D-pad → move"
echo "  B     → select"
echo "  Y     → back (in app)"
echo "  ⌂     → home (center-right below −/+ )"

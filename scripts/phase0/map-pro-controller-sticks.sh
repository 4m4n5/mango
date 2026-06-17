#!/usr/bin/env bash
# Pro Controller → keyboard using LEFT STICK axes (ABS_X/ABS_Y) + A/B.
# Your pad sends stick events, not hat D-pad — use the left stick to navigate.
# Run on the Pi: bash scripts/phase0/map-pro-controller-sticks.sh

set -euo pipefail

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
DEVICE_NAME="Pro Controller"
PRESET_NAME="mango-tv"

SWAP_AB=false
[[ "${1:-}" == "--swap-ab" ]] && SWAP_AB=true

if $SWAP_AB; then
  A_CODE=305
  B_CODE=304
else
  A_CODE=304   # BTN_SOUTH
  B_CODE=305   # BTN_EAST
fi

mkdir -p "${CONFIG_ROOT}/presets/${DEVICE_NAME}"

cat >"${CONFIG_ROOT}/presets/${DEVICE_NAME}/${PRESET_NAME}.json" <<EOF
[
  {"input_combination": [{"type": 3, "code": 0, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Left", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 0, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Right", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 1, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Up", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 1, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Down", "release_combination_keys": true},
  {"input_combination": [{"type": 1, "code": ${A_CODE}}], "target_uinput": "keyboard", "output_symbol": "Return"},
  {"input_combination": [{"type": 1, "code": ${B_CODE}}], "target_uinput": "keyboard", "output_symbol": "Esc"}
]
EOF

python3 - "$CONFIG_ROOT/config.json" "$DEVICE_NAME" "$PRESET_NAME" <<'PY'
import json, sys
path, device, preset = sys.argv[1:4]
cfg = {"version": "2.2.1", "autoload": {}}
if os.path.isfile(path):
    with open(path) as f:
        cfg = json.load(f)
import os
cfg.setdefault("autoload", {})[device] = preset
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(cfg, f, indent=4)
    f.write("\n")
print(f"Autoload: {device} -> {preset}")
PY

sudo systemctl start input-remapper 2>/dev/null || true
sudo input-remapper-control --command start-reader-service -d 2>/dev/null || true
input-remapper-control --command stop --device "$DEVICE_NAME" 2>/dev/null || true
input-remapper-control --command start --device "$DEVICE_NAME" --preset "$PRESET_NAME"

echo "=== Stick map applied ==="
echo "  Left stick → arrows (tilt to move)"
echo "  A (south)  → Return"
echo "  B (east)   → Escape"
echo "Try --swap-ab if A/B are reversed."

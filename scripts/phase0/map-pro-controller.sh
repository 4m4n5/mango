#!/usr/bin/env bash
# 8BitDo Micro (Switch BT → "Pro Controller") → keyboard for Kodi/Stremio.
#
# The Micro has D-pad + XYAB only — no stick. In Switch mode Linux reports the
# D-pad as ABS_X/ABS_Y (codes 0/1), not hat axes — evtest will show ABS_X when
# you press D-pad directions. We map both axis styles so other modes still work.
#
# Run on the Pi: bash scripts/phase0/map-pro-controller.sh

set -euo pipefail

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
DEVICE_NAME="Pro Controller"
PRESET_NAME="mango-tv"
PRESET_DIR="${CONFIG_ROOT}/presets/${DEVICE_NAME}"
PRESET_FILE="${PRESET_DIR}/${PRESET_NAME}.json"

SWAP_AB=false
[[ "${1:-}" == "--swap-ab" ]] && SWAP_AB=true

if $SWAP_AB; then
  A_CODE=305
  B_CODE=304
else
  A_CODE=304   # BTN_SOUTH (A)
  B_CODE=305   # BTN_EAST (B)
fi

mkdir -p "$PRESET_DIR"

cat >"$PRESET_FILE" <<EOF
[
  {"input_combination": [{"type": 3, "code": 0, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Left", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 0, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Right", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 1, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Up", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 1, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Down", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Left", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Right", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Up", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Down", "release_combination_keys": true},
  {"input_combination": [{"type": 1, "code": ${A_CODE}}], "target_uinput": "keyboard", "output_symbol": "Return"},
  {"input_combination": [{"type": 1, "code": ${B_CODE}}], "target_uinput": "keyboard", "output_symbol": "Esc"}
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

sudo systemctl start input-remapper 2>/dev/null || true
sudo input-remapper-control --command start-reader-service -d 2>/dev/null || true
input-remapper-control --command stop --device "$DEVICE_NAME" 2>/dev/null || true
input-remapper-control --command start --device "$DEVICE_NAME" --preset "$PRESET_NAME"

echo "=== mango-tv map applied (8BitDo Micro) ==="
echo "  D-pad → arrows"
echo "  A     → Return (select)"
echo "  B     → Escape (back)"
echo "Try --swap-ab if A/B feel reversed."

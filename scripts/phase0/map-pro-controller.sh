#!/usr/bin/env bash
# Fixed TV map for 8BitDo / Switch "Pro Controller" — desktop/Stremio (not Kodi).
# Kodi: use launch-kodi.sh instead (native gamepad).
# Run on the Pi: bash scripts/phase0/map-pro-controller.sh

set -euo pipefail

CONFIG_ROOT="${HOME}/.config/input-remapper-2"
DEVICE_NAME="Pro Controller"
PRESET_NAME="mango-tv"
PRESET_DIR="${CONFIG_ROOT}/presets/${DEVICE_NAME}"
PRESET_FILE="${PRESET_DIR}/${PRESET_NAME}.json"

SWAP_AB=false
[[ "${1:-}" == "--swap-ab" ]] && SWAP_AB=true

echo "=== mango: Pro Controller desktop preset ==="
echo "(For Kodi use: bash scripts/phase0/launch-kodi.sh — native pad, no remapper)"
echo

mkdir -p "$PRESET_DIR"

if $SWAP_AB; then
  A_CODE=305
  B_CODE=304
  echo "A/B swapped (305=confirm, 304=back)"
else
  A_CODE=304
  B_CODE=305
fi

# Hat at ±100%; hold/release via release_combination_keys
cat >"$PRESET_FILE" <<EOF
[
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Up", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 17, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Down", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": -100}], "target_uinput": "keyboard", "output_symbol": "Left", "release_combination_keys": true},
  {"input_combination": [{"type": 3, "code": 16, "analog_threshold": 100}], "target_uinput": "keyboard", "output_symbol": "Right", "release_combination_keys": true},
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
with open(path, "w") as f:
    json.dump(cfg, f, indent=4)
    f.write("\n")
print(f"Autoload: {device} -> {preset}")
PY

sudo systemctl start input-remapper 2>/dev/null || true
sudo input-remapper-control --command start-reader-service -d 2>/dev/null || true
input-remapper-control --command stop --device "$DEVICE_NAME" 2>/dev/null || true
input-remapper-control --command start --device "$DEVICE_NAME" --preset "$PRESET_NAME"

echo
echo "Desktop/Stremio map active."
echo "  D-pad → arrows   A → Return   B → Escape"
echo "Try --swap-ab if A/B feel reversed in Stremio."

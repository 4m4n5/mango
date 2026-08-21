#!/usr/bin/env bash
# Read-only controller-link diagnostic bundle for Pi-side agents.

set -euo pipefail

BT_MAC="${MANGO_GAMEPAD_BT_MAC:-E4:17:D8:EB:00:44}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"

echo "mango controller link diagnostics"
echo "timestamp=$(date -Is)"
echo "repo=$(git -C "${MANGO_REPO_DIR:-$HOME/mango}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo
echo "[bluez]"
bluetoothctl show 2>/dev/null | grep -E 'Controller|Powered|Pairable|Discovering' || true
bluetoothctl info "$BT_MAC" 2>/dev/null || true
echo
echo "[services]"
systemctl is-active mango-controller-link.service 2>/dev/null || true
systemctl --user is-active mango-tv-pad.service 2>/dev/null || true
echo
echo "[status]"
cat "$CACHE_DIR/mango-controller-link-status.json" 2>/dev/null || true
echo
cat "$CACHE_DIR/mango-tv-pad-status.json" 2>/dev/null || true
echo
echo "[input nodes]"
ls -l /dev/input/by-id/* 2>/dev/null || true
python3 - <<'PY' 2>/dev/null || true
import evdev
for path in evdev.list_devices():
    dev = evdev.InputDevice(path)
    print(f"{path}\t{dev.name}\tuniq={dev.uniq or '-'}")
    dev.close()
PY
echo
echo "[owners]"
ps -eo pid,ppid,etimes,args | grep -E '[m]ango-controller-link|[m]ango-tv-pad|[b]luetoothctl connect' || true
echo
echo "[udev]"
if [[ -f /etc/udev/rules.d/99-mango-pro-controller.rules ]]; then
  cat /etc/udev/rules.d/99-mango-pro-controller.rules
else
  echo "no Mango controller udev rule"
fi
echo
echo "[recent link log]"
journalctl -u mango-controller-link.service -n 60 --no-pager 2>/dev/null || true
echo
echo "[recent pad log]"
journalctl --user -u mango-tv-pad.service -n 60 --no-pager 2>/dev/null || true

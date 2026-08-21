#!/usr/bin/env bash
# Discover nearby Bluetooth devices (headphones show up only in pairing mode).

set -euo pipefail

# 8BitDo Micro — always visible when connected; not audio.
GAMEPAD_MAC="e4:17:d8:eb:00:44"
SECONDS="${1:-45}"

if ! command -v bluetoothctl >/dev/null 2>&1; then
  echo "bluetoothctl not found" >&2
  exit 1
fi

bluetoothctl power on >/dev/null
bluetoothctl pairable on >/dev/null 2>&1 || true

echo "=== Bluetooth scan (${SECONDS}s) ==="
echo "1. On headphones: power OFF, then hold power until LED flashes (pairing mode)."
echo "2. Disconnect them from your phone first (Settings → Bluetooth → Forget)."
echo "3. Ignore 'Pro Controller' — that is the 8BitDo gamepad."
echo

bluetoothctl scan on >/dev/null &
scan_pid=$!
trap 'bluetoothctl scan off >/dev/null 2>&1; kill "$scan_pid" 2>/dev/null || true' EXIT

seen_file="$(mktemp)"
: >"$seen_file"

for ((t = SECONDS; t > 0; t--)); do
  while IFS= read -r line; do
    mac="${line%% *}"
    mac_lc="$(echo "$mac" | tr '[:upper:]' '[:lower:]')"
  [[ "$mac_lc" == "$GAMEPAD_MAC" ]] && continue
    name="${line#* }"
    key="${mac_lc}|${name}"
    if ! grep -qxF "$key" "$seen_file" 2>/dev/null; then
      echo "$key" >>"$seen_file"
      echo "  NEW  $mac  $name"
    fi
  done < <(bluetoothctl devices 2>/dev/null || true)
  printf "\r  scanning… %2ds left " "$t"
  sleep 1
done
echo

bluetoothctl scan off >/dev/null 2>&1 || true
kill "$scan_pid" 2>/dev/null || true

echo
echo "=== All devices (except gamepad) ==="
bluetoothctl devices 2>/dev/null | grep -vi "pro controller" || echo "(none — retry with headphones in pairing mode)"

echo
echo "Pair when ready:"
echo "  bash scripts/audio/pair-bt-headphones.sh <MAC>"
echo "Easier on desk: plug wired headphones into the monitor 3.5 mm jack."

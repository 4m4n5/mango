#!/usr/bin/env bash
# Install InputStream Adaptive — required before YouTube addon on Raspberry Pi OS.
# The binary addon is NOT in Kodi's UI; it comes from apt.
# Run on the Pi: bash scripts/m1-foundation/pad/install-kodi-inputstream.sh

set -euo pipefail

echo "=== mango: InputStream Adaptive (YouTube dependency) ==="
echo

if ! command -v kodi &>/dev/null && ! command -v kodi21 &>/dev/null; then
  echo "! Kodi not installed. Run: bash scripts/m1-foundation/pad/install-kodi.sh"
  exit 1
fi

sudo apt update

PKG=""
if dpkg -l 2>/dev/null | awk '{print $2}' | grep -qx 'kodi21'; then
  PKG="kodi21-inputstream-adaptive"
elif dpkg -l 2>/dev/null | awk '{print $2}' | grep -qx 'kodi'; then
  if apt-cache show kodi21-inputstream-adaptive &>/dev/null; then
    PKG="kodi21-inputstream-adaptive"
  else
    PKG="kodi-inputstream-adaptive"
  fi
elif apt-cache show kodi21-inputstream-adaptive &>/dev/null; then
  PKG="kodi21-inputstream-adaptive"
elif apt-cache show kodi-inputstream-adaptive &>/dev/null; then
  PKG="kodi-inputstream-adaptive"
fi

if [[ -z "$PKG" ]]; then
  echo "! No inputstream-adaptive package found."
  echo "  Try: apt search kodi inputstream"
  exit 1
fi

echo "Installing: $PKG"
sudo apt install -y "$PKG"

killall kodi kodi.bin 2>/dev/null || true

echo
echo "✓ InputStream Adaptive installed"
echo "  Verify in Kodi: Settings → Add-ons → My add-ons → VideoPlayer InputStream"
echo "                  → InputStream Adaptive (should be enabled)"
echo
echo "Next: bash scripts/m1-foundation/pad/reset-kodi-youtube.sh  then install the YouTube zip"

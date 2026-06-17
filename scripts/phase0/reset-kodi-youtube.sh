#!/usr/bin/env bash
# Remove broken YouTube addon files and download a fresh zip for Kodi 21+.
# Run on the Pi: bash scripts/phase0/reset-kodi-youtube.sh
# Then install the zip in Kodi (see docs/kodi-youtube-setup.md).

set -euo pipefail

KODI_HOME="${HOME}/.kodi"
DL_DIR="${HOME}/mango/downloads"
ZIP_NAME="plugin.video.youtube-7.4.3.zip"
ZIP_URL="https://github.com/anxdpanic/plugin.video.youtube/releases/download/v7.4.3/${ZIP_NAME}"

echo "=== mango: reset Kodi YouTube addon ==="
echo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/install-kodi-inputstream.sh"
echo

killall kodi kodi.bin 2>/dev/null || true
sleep 1

echo "Removing old YouTube addon data..."
rm -rf "${KODI_HOME}/addons/plugin.video.youtube"*
rm -rf "${KODI_HOME}/userdata/addon_data/plugin.video.youtube"
rm -f "${DL_DIR}/${ZIP_NAME}"

mkdir -p "$DL_DIR"
echo "Downloading ${ZIP_NAME}..."
curl -fsSL -o "${DL_DIR}/${ZIP_NAME}" "$ZIP_URL"

echo
echo "✓ Clean slate ready"
echo "  Zip: ${DL_DIR}/${ZIP_NAME}"
echo
echo "Next — on the TV with Kodi:"
echo "  1. bash scripts/phase0/launch-kodi.sh"
echo "  2. Follow docs/kodi-youtube-setup.md (enable Unknown sources → Install from zip)"
echo

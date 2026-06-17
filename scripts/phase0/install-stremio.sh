#!/usr/bin/env bash
# Phase 0 — install Stremio for Raspberry Pi 5 (fragarray ARM64 build).
# https://github.com/fragarray/stremio-rpi5

set -euo pipefail

RELEASE_API="https://api.github.com/repos/fragarray/stremio-rpi5/releases/latest"
DOWNLOAD_DIR="${TMPDIR:-/tmp}/mango-stremio"

echo "=== Installing Stremio (fragarray/stremio-rpi5) ==="

if command -v stremio &>/dev/null; then
  echo "stremio already in PATH: $(command -v stremio)"
  stremio --version 2>/dev/null || true
  read -r -p "Reinstall anyway? [y/N] " ans
  [[ "${ans,,}" == "y" ]] || exit 0
fi

mkdir -p "$DOWNLOAD_DIR"

echo "Fetching latest release info..."
DEB_URL=$(curl -sf "$RELEASE_API" | grep -oE 'https://[^"]+arm64\.deb' | head -1)

if [[ -z "$DEB_URL" ]]; then
  echo "Could not find arm64 .deb in latest release."
  echo "Download manually from: https://github.com/fragarray/stremio-rpi5/releases"
  exit 1
fi

DEB_FILE="$DOWNLOAD_DIR/$(basename "$DEB_URL")"
echo "Downloading: $DEB_URL"
curl -fL -o "$DEB_FILE" "$DEB_URL"

echo "Installing (may take a few minutes for dependencies)..."
sudo apt install -y "$DEB_FILE"

echo
echo "=== Stremio installed ==="
echo
echo "YOU (on the Pi TV screen):"
echo "  1. Run: stremio"
echo "  2. Log in to your Stremio account"
echo "  3. Install addons manually (e.g. Torrentio) via the app UI"
echo "  4. Play something with the gamepad"
echo
echo "Test deep link (example movie):"
echo "  xdg-open 'stremio:///detail/movie/tt0816692'"

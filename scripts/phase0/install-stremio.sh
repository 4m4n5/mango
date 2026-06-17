#!/usr/bin/env bash
# Phase 0 — install Stremio for Raspberry Pi 5 (fragarray ARM64 build).
# https://github.com/fragarray/stremio-rpi5

set -euo pipefail

REPO="fragarray/stremio-rpi5"
DOWNLOAD_DIR="${TMPDIR:-/tmp}/mango-stremio"
# Pinned fallback — /releases/latest is often Windows-only
FALLBACK_DEB="https://github.com/fragarray/stremio-rpi5/releases/download/v4.4.189/stremio_4.4.181_arm64.deb"

echo "=== Installing Stremio (fragarray/stremio-rpi5) ==="

if command -v stremio &>/dev/null; then
  echo "stremio already in PATH: $(command -v stremio)"
  stremio --version 2>/dev/null || true
  read -r -p "Reinstall anyway? [y/N] " ans
  [[ "${ans,,}" == "y" ]] || exit 0
fi

find_arm64_deb_url() {
  local page=1 json url
  while (( page <= 5 )); do
    json=$(curl -sf "https://api.github.com/repos/${REPO}/releases?per_page=30&page=${page}") || return 1
    url=$(python3 - <<'PY' "$json"
import json, sys
data = json.loads(sys.argv[1])
for release in data:
    for asset in release.get("assets", []):
        name = asset.get("name", "").lower()
        if "arm64" in name and name.endswith(".deb"):
            print(asset["browser_download_url"])
            raise SystemExit(0)
PY
) || true
    if [[ -n "${url:-}" ]]; then
      echo "$url"
      return 0
    fi
    # empty page — stop
    [[ "$(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])))" "$json")" -eq 0 ]] && break
    page=$((page + 1))
  done
  return 1
}

mkdir -p "$DOWNLOAD_DIR"

echo "Finding latest arm64 .deb (skipping Windows-only /releases/latest)..."
DEB_URL=$(find_arm64_deb_url) || DEB_URL=""

if [[ -z "$DEB_URL" ]]; then
  echo "No arm64 .deb in recent releases — using pinned fallback."
  DEB_URL="$FALLBACK_DEB"
fi

DEB_FILE="$DOWNLOAD_DIR/$(basename "$DEB_URL")"
echo "Downloading: $DEB_URL"
curl -fL -o "$DEB_FILE" "$DEB_URL"

echo "Installing (may take a few minutes for dependencies)..."
sudo apt install -y "$DEB_FILE"

echo
echo "=== Stremio installed ==="
command -v stremio && stremio --version 2>/dev/null || true
echo
echo "YOU (on the Pi TV screen):"
echo "  1. Run: DISPLAY=:0 stremio &"
echo "  2. Log in to your Stremio account"
echo "  3. Install addons manually (e.g. Torrentio) via the app UI"
echo "  4. Play something with the gamepad"
echo
echo "Test deep link (example movie):"
echo "  xdg-open 'stremio:///detail/movie/tt0816692'"

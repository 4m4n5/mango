#!/usr/bin/env bash
# N1 prerequisites — mpv, socat, Node check. Run on the Pi (sudo once):
#   bash scripts/m2-catalog/service/install-m2-prereqs.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

echo "=== mango N1 prerequisites ==="
echo

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Installing packages (sudo required)..."
  sudo apt update
  sudo apt install -y mpv socat
else
  apt update
  apt install -y mpv socat
fi

echo
echo "=== verify ==="
command -v mpv && mpv --version | head -1
command -v socat && socat -V 2>&1 | head -1
command -v node && node --version
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "! WARN: node >= 20 recommended for catalog-service (have $(node --version))"
fi

echo
echo "=== next steps ==="
echo "1. Stremio addons → /etc/mango/stremio-export.json"
echo "     bash scripts/m2-catalog/service/setup-stremio-export.sh --from-local"
echo "     # or manual export: setup-stremio-export.sh /path/to/export.json"
echo "2. bash scripts/m2-catalog/service/spike-mpv-http.sh"
echo "3. bash scripts/m2-catalog/service/check-m2-prereqs.sh"
echo

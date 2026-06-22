#!/usr/bin/env bash
# Install and enable the Pi user unit for AIOMetadata.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_SRC="$REPO_DIR/config/systemd/mango-aiometadata.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_DST="$UNIT_DIR/mango-aiometadata.service"

# shellcheck source=lib/aiometadata.sh
source "$REPO_DIR/scripts/m4-addons/lib/aiometadata.sh"

cd "$REPO_DIR"
mkdir -p "$UNIT_DIR"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"

systemctl --user daemon-reload
systemctl --user enable --now mango-aiometadata.service

for _ in $(seq 1 120); do
  if aiometadata_health_ok; then
    echo "mango-aiometadata.service enabled and reachable"
    systemctl --user status mango-aiometadata.service --no-pager -l | head -12 || true
    exit 0
  fi
  sleep 1
done

systemctl --user status mango-aiometadata.service --no-pager -l >&2 || true
echo "mango-aiometadata.service enabled but :3036/health did not become reachable" >&2
exit 1

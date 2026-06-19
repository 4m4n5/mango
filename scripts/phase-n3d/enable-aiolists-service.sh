#!/usr/bin/env bash
# Install and enable the Pi user unit for AIOLists.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_SRC="$REPO_DIR/config/systemd/mango-aiolists.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_DST="$UNIT_DIR/mango-aiolists.service"

cd "$REPO_DIR"
mkdir -p "$UNIT_DIR"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"

systemctl --user daemon-reload
systemctl --user enable --now mango-aiolists.service

for _ in $(seq 1 90); do
  if curl -sf --max-time 3 http://127.0.0.1:3036/manifest.json >/dev/null \
    || curl -sf --max-time 3 http://127.0.0.1:3036/ >/dev/null; then
    echo "mango-aiolists.service enabled and reachable"
    systemctl --user status mango-aiolists.service --no-pager -l | head -12 || true
    exit 0
  fi
  sleep 1
done

systemctl --user status mango-aiolists.service --no-pager -l >&2 || true
echo "mango-aiolists.service enabled but :3036 did not become reachable" >&2
exit 1

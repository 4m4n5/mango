#!/usr/bin/env bash
# Install and enable the Pi user unit for AIOStreams.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_SRC="$REPO_DIR/config/systemd/mango-aiostreams.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_DST="$UNIT_DIR/mango-aiostreams.service"

cd "$REPO_DIR"

if [[ ! -f deploy/aiostreams/.env ]]; then
  echo "missing deploy/aiostreams/.env" >&2
  echo "copy deploy/aiostreams/.env.example and set SECRET_KEY first" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"

systemctl --user daemon-reload
systemctl --user enable --now mango-aiostreams.service

for _ in $(seq 1 60); do
  if curl -sf --max-time 3 http://127.0.0.1:3035/api/v1/status >/dev/null; then
    echo "mango-aiostreams.service enabled and healthy"
    systemctl --user status mango-aiostreams.service --no-pager -l | head -12 || true
    exit 0
  fi
  sleep 1
done

systemctl --user status mango-aiostreams.service --no-pager -l >&2 || true
echo "mango-aiostreams.service enabled but /api/v1/status did not become healthy" >&2
exit 1

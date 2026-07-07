#!/usr/bin/env bash
# Install + enable a user systemd unit that serves the NexoTV data dir over
# localhost HTTP (:7010) so NexoTV can ingest the curated AREA69 M3U.
#
# Usage: bash scripts/live/install-nexotv-m3u-http.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/mango-nexotv-m3u-http.service"
DATA_DIR="${MANGO_NEXOTV_DATA_DIR:-$HOME/.local/share/mango/nexotv/data}"
PORT="${MANGO_NEXOTV_M3U_PORT:-7010}"

mkdir -p "$UNIT_DIR" "$DATA_DIR"

cat >"$UNIT_PATH" <<EOF
[Unit]
Description=mango NexoTV data HTTP server (localhost AREA69 M3U for NexoTV M3U provider)
After=default.target

[Service]
Type=simple
ExecStart=/usr/bin/bash $REPO_DIR/scripts/live/serve-nexotv-data.sh
Restart=on-failure
RestartSec=5
Environment=MANGO_NEXOTV_DATA_DIR=$DATA_DIR
Environment=MANGO_NEXOTV_M3U_PORT=$PORT

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now mango-nexotv-m3u-http.service >/dev/null

# Wait briefly for the socket to come up.
for _ in $(seq 1 10); do
  if curl -sf --max-time 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    echo "NexoTV M3U HTTP server ready: http://127.0.0.1:$PORT/ (serving $DATA_DIR)"
    exit 0
  fi
  sleep 0.5
done

echo "NexoTV M3U HTTP server did not come up at :$PORT" >&2
systemctl --user status mango-nexotv-m3u-http.service --no-pager >&2 || true
exit 1

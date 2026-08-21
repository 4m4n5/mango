#!/usr/bin/env bash
# Optional loopback PO-token provider for YouTube mweb escalation.
# Binds 127.0.0.1 only. Tokens stay in memory. Disabled unless opted in.

set -euo pipefail

PLUGIN_DIR="${MANGO_YTDLP_PLUGIN_DIR:-$HOME/.local/share/mango/ytdlp-plugins}"
POT_URL="${MANGO_YOUTUBE_POT_URL:-http://127.0.0.1:4416}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if [[ ! "$POT_URL" =~ ^https?://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/?$ ]]; then
  echo "youtube pot: refusing non-loopback URL" >&2
  exit 1
fi

install_unit() {
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT_DIR/mango-youtube-pot.service" <<EOF
[Unit]
Description=Mango loopback YouTube PO-token provider
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/npx --yes bgutil-ytdlp-pot-provider
Environment=PORT=4416
Environment=HOST=127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
}

case "${1:-status}" in
  install)
    mkdir -p "$PLUGIN_DIR"
    if [[ "${MANGO_YOUTUBE_POT_INSTALL_PLUGIN:-1}" == "1" ]]; then
      echo "youtube pot: plugin dir $PLUGIN_DIR (yt-dlp discovers bgutil here if installed)"
    fi
    install_unit
    echo "youtube pot: unit written; enable with systemctl --user enable --now mango-youtube-pot.service"
    ;;
  ping|status)
    if curl -fsS --max-time 1 "$POT_URL/ping" >/dev/null 2>&1 \
      || curl -fsS --max-time 1 "$POT_URL" >/dev/null 2>&1; then
      echo "youtube pot: ready on loopback"
      exit 0
    fi
    echo "youtube pot: not running (anonymous visionos playback still works)"
    exit 0
    ;;
  *)
    echo "usage: $0 [status|install]" >&2
    exit 2
    ;;
esac

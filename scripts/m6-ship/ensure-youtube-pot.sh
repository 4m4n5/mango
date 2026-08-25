#!/usr/bin/env bash
# Install or inspect Mango's supervised loopback YouTube PO-token provider.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
POT_URL="${MANGO_YOUTUBE_POT_URL:-http://127.0.0.1:4416}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_SRC="$REPO_ROOT/scripts/m1-foundation/ui/systemd/mango-youtube-pot.service"

if [[ ! "$POT_URL" =~ ^https?://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/?$ ]]; then
  echo "youtube pot: refusing non-loopback URL" >&2
  exit 1
fi

install_unit() {
  mkdir -p "$UNIT_DIR"
  install -m 0644 "$UNIT_SRC" "$UNIT_DIR/mango-youtube-pot.service"
  systemctl --user daemon-reload
}

case "${1:-status}" in
  install)
    bash "$REPO_ROOT/scripts/m6-ship/ensure-youtube-yt-dlp.sh"
    install_unit
    systemctl --user enable --now mango-youtube-pot.service
    echo "youtube pot: supervised loopback unit installed"
    ;;
  ping|status)
    if curl -fsS --max-time 1 "$POT_URL/ping" >/dev/null 2>&1 \
      || curl -fsS --max-time 1 "$POT_URL" >/dev/null 2>&1; then
      echo "youtube pot: ready on loopback"
      exit 0
    fi
    echo "youtube pot: supervised loopback provider is not ready" >&2
    exit 1
    ;;
  *)
    echo "usage: $0 [status|ping|install]" >&2
    exit 2
    ;;
esac

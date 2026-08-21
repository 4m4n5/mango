#!/usr/bin/env bash
# Request safe controller-link actions. The root service owns BlueZ itself.

set -euo pipefail

ACTION="${1:---status}"
STATUS_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/mango/mango-controller-link-status.json"
SERVICE="mango-controller-link.service"

case "$ACTION" in
  --status)
    if [[ -s "$STATUS_FILE" ]]; then
      cat "$STATUS_FILE"
      exit 0
    fi
    echo '{"ok":false,"state":"missing","error":"controller link status missing"}'
    exit 1
    ;;
  --retry)
    sudo -n systemctl kill --signal=USR1 "$SERVICE"
    ;;
  --repair)
    sudo -n systemctl kill --signal=USR2 "$SERVICE"
    ;;
  --restart)
    sudo -n systemctl restart "$SERVICE"
    ;;
  *)
    echo "usage: $0 [--status|--retry|--repair|--restart]" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# Stable playability CLI. Existing timer/gate wrappers stay in place.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CMD="${1:-}"
shift || true

case "$CMD" in
  refresh)
    exec bash "$ROOT/scripts/m3-play/playability/playability-refresh-level.sh" "$@"
    ;;
  top-up)
    exec bash "$ROOT/scripts/m3-play/playability/playability-grow.sh" "$@"
    ;;
  verify)
    exec bash "$ROOT/scripts/m3-play/playability/gate-m3-verified-rails.sh" "$@"
    ;;
  maintenance)
    exec bash "$ROOT/scripts/m3-play/playability/playability-maintenance.sh" "$@"
    ;;
  *)
    echo "usage: bash scripts/m3-play/playability/mango-playability.sh refresh|top-up|verify|maintenance" >&2
    exit 2
    ;;
esac

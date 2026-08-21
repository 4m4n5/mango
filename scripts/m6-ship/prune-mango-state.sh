#!/usr/bin/env bash
# Prune Mango SQLite generation history and compact library.db.
# Stops catalog-service only (does not run mango-stack.sh, so it will not
# copy a bloated library.db into state backups). Restores catalog after.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/catalog-service-stack.sh
source "$REPO_DIR/scripts/lib/catalog-service-stack.sh"

VACUUM=0
if [[ "${1:-}" == "--vacuum" ]]; then
  VACUUM=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--vacuum]" >&2
  exit 2
fi

python_prune="$REPO_DIR/scripts/m6-ship/prune-mango-sqlite.py"
node_prune="$REPO_DIR/src/catalog-service/dist/library/prune-cli.js"
if [[ ! -f "$python_prune" && ! -f "$node_prune" ]]; then
  echo "prune helper missing; pull main or build catalog-service" >&2
  exit 1
fi

watchdog_enabled=0
if command -v systemctl >/dev/null 2>&1 \
  && systemctl --user is-enabled mango-watchdog.timer >/dev/null 2>&1; then
  watchdog_enabled=1
fi

restore_services() {
  if [[ "$watchdog_enabled" == "1" ]]; then
    systemctl --user start mango-watchdog.timer >/dev/null 2>&1 || true
  fi
  start_catalog_service_only || true
}
trap restore_services EXIT

if [[ "$watchdog_enabled" == "1" ]]; then
  echo "stopping watchdog so it cannot restart catalog mid-prune"
  systemctl --user stop mango-watchdog.timer mango-watchdog.service 2>/dev/null || true
fi

echo "stopping catalog-service for exclusive prune"
stop_catalog_service_only

if [[ -f "$python_prune" ]]; then
  args=(--apply)
  if [[ "$VACUUM" == "1" ]]; then
    args+=(--vacuum)
  fi
  python3 "$python_prune" "${args[@]}"
else
  cd "$REPO_DIR/src/catalog-service"
  args=()
  if [[ "$VACUUM" == "1" ]]; then
    args+=(--vacuum)
  fi
  node "$node_prune" "${args[@]}"
fi

echo "starting catalog-service"
trap - EXIT
if [[ "$watchdog_enabled" == "1" ]]; then
  systemctl --user start mango-watchdog.timer >/dev/null 2>&1 || true
fi
start_catalog_service_only

#!/usr/bin/env bash
# Isolated low-priority worker that processes vod_desired_revisions serially
# and cannot crash the catalog. Holds a filesystem lease so a runaway worker
# never overlaps with itself; the catalog service reads the lease heartbeat
# for diagnostics only.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ "${MANGO_VOD_RECS_WORKER:-0}" != "1" ]]; then
  echo "vod-recs-worker disabled: MANGO_VOD_RECS_WORKER=${MANGO_VOD_RECS_WORKER:-0}" >&2
  exit 0
fi

if [[ ! -f src/catalog-service/dist/recommendations/worker-cli.js ]]; then
  echo "vod-recs-worker dist missing; run: cd src/catalog-service && npm ci && npm run build" >&2
  exit 1
fi

lease_dir="${MANGO_VOD_RECS_WORKER_LEASE_DIR:-$HOME/.cache/mango}"
mkdir -p "$lease_dir"
lease_path="$lease_dir/vod-recs-worker.lease"

cd "$REPO_DIR/src/catalog-service"
exec env \
  MANGO_REPO_DIR="$REPO_DIR" \
  MANGO_VOD_RECS_WORKER_LEASE="$lease_path" \
  node dist/recommendations/worker-cli.js "$@"

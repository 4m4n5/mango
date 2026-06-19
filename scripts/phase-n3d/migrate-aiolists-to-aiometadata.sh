#!/usr/bin/env bash
# Stop AIOLists and bring up AIOMetadata on the same :3036 slot.
# Configure UI + stremio-export update still required — see configure-aiometadata.md

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

echo "== migrate AIOLists → AIOMetadata =="

if systemctl --user is-active mango-aiolists.service >/dev/null 2>&1; then
  echo "Stopping mango-aiolists.service"
  systemctl --user stop mango-aiolists.service
  systemctl --user disable mango-aiolists.service || true
fi

if [[ -d deploy/aiolists ]]; then
  # shellcheck source=../lib/docker-compose.sh
  source "$REPO_DIR/scripts/lib/docker-compose.sh"
  (cd deploy/aiolists && docker_compose down) 2>/dev/null || true
fi

bash "$REPO_DIR/scripts/phase-n3d/install-aiometadata.sh"
bash "$REPO_DIR/scripts/phase-n3d/enable-aiometadata-service.sh"

cat <<'EOF'

Next (operator):
  1. Open http://127.0.0.1:3036/configure (ssh -L 3036:127.0.0.1:3036 mango)
  2. Set TMDB + MDBList keys; add custom lists from map-mdblist-catalogs.md
  3. Copy manifest URL → /etc/mango/stremio-export.json as "AIOMetadata"
  4. sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml
  5. bash scripts/phase-n3d/aiometadata-catalogs.sh  # verify mdblist.* ids
  6. bash scripts/phase-n3d/gate-n3d-catalogs.sh
  7. bash scripts/phase-n3c/fill-playability-db.sh

EOF

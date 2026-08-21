#!/usr/bin/env bash
# Operator status for Mango couch-idle gate.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

bash scripts/lib/couch-activity.sh status

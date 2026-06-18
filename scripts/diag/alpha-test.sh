#!/usr/bin/env bash
# Alpha test entry — restart mango with full diagnostic logging.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/restart-with-diag.sh"

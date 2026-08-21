#!/usr/bin/env bash
# Gate: Library Grower — unified regression (monitor, grow rail, compose, cursors, ops SLA).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/gate-library-grow-lib.sh
source "$SCRIPT_DIR/lib/gate-library-grow-lib.sh"
gate_library_grow_run

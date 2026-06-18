#!/usr/bin/env bash
# Mac: pull on Pi and run pre-couch gate.
# Usage: bash scripts/pi-exec-gate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="${MANGO_SSH_HOST:-mango}"

ssh -o ConnectTimeout=12 "$HOST" "bash -lc 'cd ~/mango && git pull && bash scripts/pi-pre-couch-gate.sh'"

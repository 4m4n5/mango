#!/usr/bin/env bash
# Mac: pull on Pi and run pre-couch gate.
# Usage: bash scripts/pi-exec-gate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST="${MANGO_SSH_HOST:-mango}"
BRANCH="${MANGO_BRANCH:-$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || echo main)}"

ssh -o ConnectTimeout=12 "$HOST" \
  "bash -lc 'cd ~/mango && git fetch origin && git checkout $(printf '%q' "$BRANCH") && git pull --ff-only && bash scripts/pi-pre-couch-gate.sh'"

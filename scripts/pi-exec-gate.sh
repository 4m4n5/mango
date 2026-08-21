#!/usr/bin/env bash
# Mac: verify the Pi is on the expected SHA and run pre-couch gate.
# Never rsync — see docs/OPERATIONS.md
# Usage: bash scripts/pi-exec-gate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/pi-deploy-preflight.sh
source "$SCRIPT_DIR/lib/pi-deploy-preflight.sh"

HOST="${MANGO_SSH_HOST:-mango}"
BRANCH="${MANGO_BRANCH:-$(git -C "$REPO_DIR" branch --show-current 2>/dev/null || true)}"

mango_require_deploy_branch "$BRANCH"
mango_refuse_unexpected_dirty "$REPO_DIR" "Mac"
mango_fetch_origin_branch "$REPO_DIR" "$BRANCH"
LOCAL="$(git -C "$REPO_DIR" rev-parse HEAD)"
EXPECTED="$(mango_expected_deploy_sha "$REPO_DIR" "$BRANCH")"
mango_require_sha "Mac HEAD" "$LOCAL" "$EXPECTED"

ssh -o ConnectTimeout=12 "$HOST" \
  "bash -lc $(printf '%q' "set -euo pipefail; cd ~/mango; git fetch origin $(printf '%q' "$BRANCH"); actual=\$(git rev-parse HEAD); expected=$(printf '%q' "$EXPECTED"); if [[ \"\$actual\" != \"\$expected\" ]]; then echo \"Pi SHA \$actual does not match expected \$expected\" >&2; exit 1; fi; bash scripts/pi-pre-couch-gate.sh")"

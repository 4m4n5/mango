#!/usr/bin/env bash
# Pre-couch gate — run on Pi before TV testing.
# Mac: bash scripts/pi-exec-gate.sh
# Refresh first: bash scripts/mango-refresh.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

echo "=== pre-couch $(hostname) $(git rev-parse --short HEAD 2>/dev/null) ==="

BRANCH="$(git branch --show-current 2>/dev/null || echo main)"
if git fetch origin 2>/dev/null; then
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || echo "")"
  [[ -z "$REMOTE" || "$LOCAL" == "$REMOTE" ]] || {
    echo "FAIL: behind origin/${BRANCH} — git pull" >&2
    exit 1
  }
fi

if [[ "$BRANCH" == "feat/native-experience" ]]; then
  bash scripts/phase-n0/gate-n0.sh
  if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
    curl -sf --max-time 5 http://127.0.0.1:3020/health >/dev/null \
      || { echo "FAIL: catalog down — bash scripts/mango-refresh.sh" >&2; exit 1; }
    if [[ "${MANGO_SELF_HOSTED_ADDONS:-0}" == "1" || -f /etc/mango/aiostreams.enabled ]]; then
      bash scripts/phase-n3d/gate-n3d-self-hosted.sh
    elif [[ -x scripts/phase-n3c/gate-n3c-verified-rails.sh ]]; then
      bash scripts/phase-n3c/gate-n3c-verified-rails.sh
    fi
  fi
  echo "PRE-COUCH: PASS"
  exit 0
fi

bash scripts/verify-tv.sh --quiet
systemctl --user is-active mango-tv-pad.service &>/dev/null \
  || pgrep -f '[m]ango-tv-pad\.py' >/dev/null \
  || { echo "FAIL: pad not running" >&2; exit 1; }
echo "PRE-COUCH: PASS"
exit 0

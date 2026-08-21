#!/usr/bin/env bash
# Verify diag + pad prerequisites on the Pi.

set -euo pipefail

OK=true
warn() { echo "! $*"; OK=false; }
pass() { echo "✓ $*"; }

if sudo -n true 2>/dev/null; then
  pass "passwordless sudo (sudo -n)"
else
  warn "passwordless sudo missing — pad grab needs one interactive: bash ~/mango/scripts/m1-foundation/pad/start-mango-tv-pad.sh"
fi

if pgrep -f 'python3.*mango-tv-pad.py' >/dev/null; then
  pass "mango-tv-pad running"
else
  warn "mango-tv-pad not running (⌂ home will not work in Kodi)"
fi

if systemctl is-active --quiet input-remapper 2>/dev/null && ! pgrep -f mango-tv-pad.py >/dev/null; then
  warn "input-remapper active without pad — ⌂ uses Control+Alt+m (broken in Kodi)"
fi

if [[ -f "${HOME}/.cache/mango/diag/current_session" ]]; then
  pass "diag session: $(cat "${HOME}/.cache/mango/diag/current_session")"
else
  warn "no diag session — run: bash ~/mango/scripts/diag/start-session.sh"
fi

$OK && exit 0 || exit 1

#!/usr/bin/env bash
# Automated pre-couch gate — run on the Pi before handoff to TV testing.
# Mac: bash scripts/pi-exec-gate.sh
# Pi:  cd ~/mango && bash scripts/pi-pre-couch-gate.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

ERRORS=0
WARNS=0

pass() { echo "✓ $*"; }
fail() { echo "✗ $*" >&2; ERRORS=$((ERRORS + 1)); }
warn() { echo "! $*" >&2; WARNS=$((WARNS + 1)); }

echo "=== mango pre-couch gate ==="
echo "host: $(hostname) · $(date -Is)"
echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

# --- 1. Git sync ---
echo "--- git ---"
if git fetch origin main 2>/dev/null; then
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse origin/main 2>/dev/null || echo "")"
  if [[ -n "$REMOTE" && "$LOCAL" != "$REMOTE" ]]; then
    fail "behind origin/main — run: git pull"
  else
    pass "in sync with origin/main"
  fi
fi
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  warn "dirty working tree (local Pi edits — prefer git-only deploy)"
fi

# --- 2. TV health API ---
echo "--- tv health ---"
if bash scripts/verify-tv.sh --quiet; then
  pass "verify-tv.sh"
else
  fail "verify-tv.sh"
fi

# --- 3. Pad router ---
echo "--- pad ---"
AMAN_UID="$(id -u)"
export XDG_RUNTIME_DIR="/run/user/${AMAN_UID}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
if systemctl --user is-active mango-tv-pad.service &>/dev/null; then
  pass "mango-tv-pad.service active"
elif pgrep -f '[m]ango-tv-pad\.py' >/dev/null; then
  pass "mango-tv-pad.py running (no systemd)"
else
  fail "pad not running — systemctl --user start mango-tv-pad.service"
fi
if sudo -n true 2>/dev/null; then
  pass "passwordless sudo for pad grab"
else
  warn "sudo needs password — run: sudo bash scripts/phase0/install-pad-sudoers.sh"
fi
if python3 -c "import evdev" 2>/dev/null; then
  if python3 -c "
import evdev
for p in evdev.list_devices():
    if evdev.InputDevice(p).name == 'Pro Controller':
        raise SystemExit(0)
raise SystemExit(1)
" 2>/dev/null; then
    pass "Pro Controller input device visible"
  else
    warn "Pro Controller not in evdev — press any pad button to wake BT"
  fi
else
  fail "python3-evdev missing"
fi

# --- 4. Bluetooth ---
echo "--- bluetooth ---"
BT_MAC="E4:17:D8:EB:00:44"
if bluetoothctl info "$BT_MAC" 2>/dev/null | grep -q "Connected: yes"; then
  pass "Micro connected ($BT_MAC)"
else
  warn "Micro not connected — press any button (trusted auto-reconnect)"
fi

# --- 5. Launcher window ---
echo "--- launcher chrome ---"
if command -v xdotool >/dev/null 2>&1; then
  if xdotool search --class 'mango-launcher' 2>/dev/null | head -1 | grep -q .; then
    pass "mango-launcher window present"
  else
    fail "no mango-launcher window — bash scripts/phase1/restart-mango-ui.sh"
  fi
else
  warn "xdotool missing — skip window check"
fi

# --- 6. Pad log sanity ---
echo "--- pad log ---"
if [[ -f /tmp/mango-tv-pad.log ]]; then
  if tail -20 /tmp/mango-tv-pad.log | grep -qE 'router ready|mango-tv-pad: /dev/input'; then
    pass "pad log shows grab or wait loop"
  elif tail -5 /tmp/mango-tv-pad.log | grep -q 'No such device'; then
    fail "pad log: stale disconnect — systemctl --user restart mango-tv-pad.service"
  else
    warn "pad log unclear — tail /tmp/mango-tv-pad.log"
  fi
else
  warn "no /tmp/mango-tv-pad.log yet"
fi

# --- 7. Phase 2 (optional) ---
echo "--- phase 2 (optional) ---"
if [[ "${MANGO_VOICE:-0}" == "1" ]]; then
  if curl -sf --max-time 2 http://127.0.0.1:8765/health >/dev/null 2>&1; then
    pass "orchestrator /health"
  else
    fail "MANGO_VOICE=1 but orchestrator down"
  fi
else
  pass "voice stack not enabled (MANGO_VOICE≠1) — overlay skipped by design"
fi

echo
echo "=== couch scenarios (manual — not automated) ==="
cat <<'EOF'
| # | Flow | Pass |
|---|------|------|
| C1 | Launcher D-pad + B select tile | |
| C2 | Stremio → ⌂ → YouTube → ⌂ → Stremio | |
| C3 | Pad drop → one button → launcher works | |
| C4 | (voice) Phone PTT → overlay states → idle | |
EOF

echo
if (( ERRORS > 0 )); then
  echo "GATE FAIL: $ERRORS error(s), $WARNS warning(s)"
  exit 1
fi
echo "GATE PASS: automated checks ok ($WARNS warning(s)) — proceed to couch C1–C3"
exit 0

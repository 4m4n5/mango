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
BRANCH="$(git branch --show-current 2>/dev/null || echo main)"
REMOTE_REF="origin/main"
if [[ "$BRANCH" == "feat/native-experience" ]]; then
  REMOTE_REF="origin/feat/native-experience"
fi
if git fetch origin 2>/dev/null; then
  LOCAL="$(git rev-parse HEAD)"
  REMOTE="$(git rev-parse "$REMOTE_REF" 2>/dev/null || echo "")"
  if [[ -n "$REMOTE" && "$LOCAL" != "$REMOTE" ]]; then
    fail "behind $REMOTE_REF — run: git pull"
  else
    pass "in sync with $REMOTE_REF"
  fi
fi
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  warn "dirty working tree (local Pi edits — prefer git-only deploy)"
fi

if [[ "$BRANCH" == "feat/native-experience" && -x scripts/phase-n0/gate-n0.sh ]]; then
  echo "--- native N0 ---"
  if bash scripts/phase-n0/gate-n0.sh; then
    pass "gate-n0.sh"
  else
    fail "gate-n0.sh"
  fi
  if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
    # shellcheck disable=SC1091
    source "${HOME}/.config/mango/voice.env"
  fi
  if [[ "${MANGO_CATALOG:-0}" == "1" ]]; then
    echo "--- native N1+N2 ---"
    bash scripts/phase-n1/check-n1-prereqs.sh && pass "check-n1-prereqs" || fail "check-n1-prereqs"
    if [[ -x scripts/phase-n2/check-n2-prereqs.sh ]]; then
      bash scripts/phase-n2/check-n2-prereqs.sh && pass "check-n2-prereqs" || fail "check-n2-prereqs"
    fi
    if curl -sf --max-time 3 http://127.0.0.1:3020/health >/tmp/mango-precouch-catalog.json; then
      pass "catalog-service /health"
    else
      fail "catalog-service down — set MANGO_CATALOG=1 in voice.env and: bash scripts/mango-stack.sh restart"
    fi
    if [[ -x scripts/phase-n3c/gate-n3c-verified-rails.sh ]]; then
      bash scripts/phase-n3c/gate-n3c-verified-rails.sh && pass "gate-n3c-verified-rails" || fail "gate-n3c-verified-rails"
    elif [[ -x scripts/phase-n3/gate-n3-play.sh ]]; then
      bash scripts/phase-n3/gate-n3-play.sh && pass "gate-n3-play" || fail "gate-n3-play"
    elif [[ -x scripts/phase-n2/gate-n2-browse.sh ]]; then
      bash scripts/phase-n2/gate-n2-browse.sh && pass "gate-n2-browse" || fail "gate-n2-browse"
    fi
  fi
  echo
  echo "=== couch scenarios (manual — N3) ==="
  cat <<'EOF'
| # | Flow | Pass |
|---|------|------|
| N3-C1 | Trending India title → detail → B Play ≤15 s | |
| N3-C2 | Second title from different rail → Play ≤15 s | |
| N3-C3 | No API/mpv error text on status line | |
| N3-C4 | ⌂ → home < 1 s after play | |
| N3-C5 | Phone PTT → HUD on TV (voice regression) | |
EOF
  echo
  if (( ERRORS > 0 )); then
    echo "GATE FAIL: $ERRORS error(s), $WARNS warning(s)"
    exit 1
  fi
  echo "GATE PASS: native automated checks ok ($WARNS warning(s))"
  exit 0
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
  orch_ok=0
  if curl -sf --max-time 2 http://127.0.0.1:8765/health >/dev/null 2>&1; then
    orch_ok=1
  elif curl -skf --max-time 2 https://127.0.0.1:8765/health >/dev/null 2>&1; then
    orch_ok=1
  fi
  if (( orch_ok )); then
    pass "orchestrator /health"
  else
    fail "MANGO_VOICE=1 but orchestrator down — bash scripts/phase2/start-voice-stack.sh"
  fi
  if curl -skf --max-time 2 https://127.0.0.1:3001/ >/dev/null 2>&1; then
    pass "companion HTTPS :3001"
  else
    fail "companion HTTPS down — bash scripts/phase2/start-voice-stack.sh"
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

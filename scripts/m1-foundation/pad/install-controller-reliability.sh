#!/usr/bin/env bash
# Install Mango's single-owner Bluetooth controller recovery stack on the Pi.
# Safe modes: --check observes, --apply mutates idempotently, --rollback restores
# the exact pre-apply main.conf only when no later configuration changed it.

set -euo pipefail

MODE="${1:---check}"
case "$MODE" in
  --check|--apply|--rollback) ;;
  *) echo "usage: $0 [--check|--apply|--rollback]" >&2; exit 2 ;;
esac

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0 $MODE" >&2
  exit 1
fi

TV_USER="${SUDO_USER:-aman}"
TV_HOME="/home/${TV_USER}"
REPO_DIR="${MANGO_REPO_DIR:-${TV_HOME}/mango}"
BT_MAC="${MANGO_GAMEPAD_BT_MAC:-E4:17:D8:EB:00:44}"
MAIN_CONF="/etc/bluetooth/main.conf"
STATE_DIR="/etc/mango/controller-reliability"
STATE_FILE="${STATE_DIR}/install-state.json"
UNIT_SRC="${REPO_DIR}/scripts/m1-foundation/ui/systemd/mango-controller-link.service"
UNIT_DST="/etc/systemd/system/mango-controller-link.service"
PAD_UNIT_SRC="${REPO_DIR}/scripts/m1-foundation/ui/systemd/mango-tv-pad.service"
PAD_UNIT_DST="${TV_HOME}/.config/systemd/user/mango-tv-pad.service"
STALE_UDEV="/etc/udev/rules.d/99-mango-pro-controller.rules"
CONFIG_PATCHER="${REPO_DIR}/scripts/m1-foundation/pad/controller-link-config.py"
USER_UID="$(id -u "$TV_USER")"
USER_RUNTIME="/run/user/${USER_UID}"

say() { echo "mango-controller-install: $*"; }
fail() { echo "mango-controller-install: $*" >&2; exit 1; }

run_user_systemctl() {
  sudo -u "$TV_USER" XDG_RUNTIME_DIR="$USER_RUNTIME" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=${USER_RUNTIME}/bus" systemctl --user "$@"
}

device_info() {
  bluetoothctl info "$BT_MAC" 2>/dev/null || true
}

require_pairing() {
  local info
  info="$(device_info)"
  grep -q "Paired: yes" <<<"$info" || fail "controller is not paired; use the explicit pairing recovery flow"
  grep -q "Bonded: yes" <<<"$info" || fail "controller is not bonded; use the explicit pairing recovery flow"
  grep -q "Trusted: yes" <<<"$info" || fail "controller is not trusted; refusing to alter pairing"
  grep -q "Blocked: no" <<<"$info" || fail "controller is blocked; unblock it before installation"
}

config_value() {
  local section="$1" key="$2"
  python3 - "$MAIN_CONF" "$section" "$key" <<'PY'
import configparser
import sys

parser = configparser.ConfigParser(strict=False, interpolation=None)
parser.optionxform = str
parser.read(sys.argv[1])
print(parser.get(sys.argv[2], sys.argv[3], fallback=""))
PY
}

stale_udev_present() {
  [[ -f "$STALE_UDEV" ]] && grep -q 'scripts/phase0/on-pro-controller-connect.sh' "$STALE_UDEV"
}

check() {
  local bad=0
  command -v bluetoothctl >/dev/null || { say "FAIL bluetoothctl missing"; bad=1; }
  python3 -c 'import dbus; from gi.repository import GLib' >/dev/null 2>&1 \
    || { say "FAIL python3-dbus/python3-gi missing"; bad=1; }
  [[ -f "$MAIN_CONF" ]] || { say "FAIL missing $MAIN_CONF"; bad=1; }
  [[ -f "$UNIT_SRC" ]] || { say "FAIL missing link unit source"; bad=1; }
  [[ -f "$PAD_UNIT_SRC" ]] || { say "FAIL missing pad unit source"; bad=1; }
  [[ -f "$CONFIG_PATCHER" ]] || { say "FAIL missing config patcher"; bad=1; }
  require_pairing
  if stale_udev_present; then
    say "WARN stale Phase 0 udev rule detected"
  fi
  for spec in "General FastConnectable true" "General AlwaysPairable false" \
    "Policy AutoEnable true" "Policy ReconnectAttempts 7" \
    "Policy ReconnectIntervals 1,2,4,8,16,32,64" \
    "Policy ReconnectUUIDs 00001124-0000-1000-8000-00805f9b34fb"; do
    read -r section key expected <<<"$spec"
    if [[ "$(config_value "$section" "$key")" != "$expected" ]]; then
      say "FAIL $section/$key is not managed value $expected"
      bad=1
    fi
  done
  if [[ "$bad" == "1" ]]; then
    exit 1
  fi
  say "check complete"
}

backup_and_patch_main_conf() {
  mkdir -p "$STATE_DIR"
  local timestamp backup before after
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="${STATE_DIR}/main.conf.${timestamp}.bak"
  before="$(sha256sum "$MAIN_CONF" | awk '{print $1}')"
  cp -p "$MAIN_CONF" "$backup"
  python3 "$CONFIG_PATCHER" --patch "$MAIN_CONF"
  after="$(sha256sum "$MAIN_CONF" | awk '{print $1}')"
  python3 - "$STATE_FILE" "$backup" "$before" "$after" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(json.dumps({
    "backup": sys.argv[2],
    "before_sha256": sys.argv[3],
    "after_sha256": sys.argv[4],
}, indent=2) + "\n", encoding="utf-8")
PY
}

apply() {
  check
  backup_and_patch_main_conf
  install -m 0644 "$UNIT_SRC" "$UNIT_DST"
  install -d -m 0755 -o "$TV_USER" -g "$TV_USER" "${TV_HOME}/.config/systemd/user"
  install -m 0644 -o "$TV_USER" -g "$TV_USER" "$PAD_UNIT_SRC" "$PAD_UNIT_DST"
  chmod +x \
    "$REPO_DIR/scripts/m1-foundation/pad/mango-controller-link.py" \
    "$CONFIG_PATCHER" \
    "$REPO_DIR/scripts/m1-foundation/pad/controller-link-control.sh" \
    "$REPO_DIR/scripts/m1-foundation/pad/mango-tv-pad.py"
  MANGO_TV_USER="$TV_USER" bash "$REPO_DIR/scripts/m1-foundation/pad/install-pad-sudoers.sh"
  if stale_udev_present; then
    cp -p "$STALE_UDEV" "${STATE_DIR}/99-mango-pro-controller.rules.bak"
    rm -f "$STALE_UDEV"
    udevadm control --reload-rules
    say "removed stale Phase 0 udev hook"
  fi
  systemctl daemon-reload
  systemctl enable mango-controller-link.service
  bluetoothctl power on >/dev/null 2>&1 || true
  bluetoothctl trust "$BT_MAC" >/dev/null 2>&1 || true
  bluetoothctl wake on "$BT_MAC" >/dev/null 2>&1 || true
  bluetoothctl pairable off >/dev/null 2>&1 || true
  systemctl restart bluetooth.service
  systemctl restart mango-controller-link.service
  run_user_systemctl daemon-reload
  run_user_systemctl enable mango-tv-pad.service
  run_user_systemctl restart mango-tv-pad.service || true
  require_pairing
  say "apply complete; controller link is running"
}

rollback() {
  [[ -f "$STATE_FILE" ]] || fail "no Mango controller install state found"
  local backup expected current
  backup="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["backup"])' "$STATE_FILE")"
  expected="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["after_sha256"])' "$STATE_FILE")"
  current="$(sha256sum "$MAIN_CONF" | awk '{print $1}')"
  [[ "$current" == "$expected" ]] || fail "main.conf changed after Mango install; refusing to overwrite it"
  [[ -f "$backup" ]] || fail "backup missing: $backup"
  cp -p "$backup" "$MAIN_CONF"
  systemctl disable --now mango-controller-link.service || true
  rm -f "$UNIT_DST"
  systemctl daemon-reload
  systemctl restart bluetooth.service
  say "rollback complete; pairing records were preserved"
}

case "$MODE" in
  --check) check ;;
  --apply) apply ;;
  --rollback) rollback ;;
esac

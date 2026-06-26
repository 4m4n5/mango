#!/usr/bin/env bash
# One-time Pi setup: trusted BT auto-reconnect + udev + systemd pad router.
# Run on the Pi:
#   cd ~/mango && git pull
#   sudo bash scripts/m1-foundation/pad/install-pad-autoreconnect.sh
#   bash scripts/m1-foundation/pad/start-mango-tv-pad.sh

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run: sudo bash $0" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
USER_NAME="${SUDO_USER:-aman}"
HOME_DIR="/home/${USER_NAME}"
BT_MAC="E4:17:D8:EB:00:44"
UDEV_RULE="/etc/udev/rules.d/99-mango-pro-controller.rules"
HOOK="${REPO_DIR}/scripts/m1-foundation/pad/on-pro-controller-connect.sh"
UNIT_SRC="${REPO_DIR}/scripts/m1-foundation/ui/systemd/mango-tv-pad.service"
UNIT_DST="${HOME_DIR}/.config/systemd/user/mango-tv-pad.service"
USER_UID="$(id -u "$USER_NAME")"
USER_RUNTIME="/run/user/${USER_UID}"

run_user_systemctl() {
  sudo -u "$USER_NAME" \
    XDG_RUNTIME_DIR="$USER_RUNTIME" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=${USER_RUNTIME}/bus" \
    systemctl --user "$@"
}

echo "=== mango: pad auto-reconnect ==="

bash "${SCRIPT_DIR}/install-pad-sudoers.sh"

chmod +x "$HOOK"
chmod +x "${SCRIPT_DIR}/run-mango-tv-pad.sh"
chmod +x "${SCRIPT_DIR}/start-mango-tv-pad.sh"

cat >"$UDEV_RULE" <<EOF
# mango — when 8BitDo Micro input appears, reconnect pad router.
ACTION=="add", SUBSYSTEM=="input", ATTR{name}=="Pro Controller", \\
  RUN+="/usr/bin/sudo -u ${USER_NAME} DISPLAY=:0 XAUTHORITY=${HOME_DIR}/.Xauthority ${HOOK}"
EOF
chmod 644 "$UDEV_RULE"
udevadm control --reload-rules
udevadm trigger --subsystem-match=input --action=add 2>/dev/null || true

echo "=== Bluetooth trust + auto-connect ==="
systemctl enable bluetooth 2>/dev/null || true
systemctl start bluetooth 2>/dev/null || true
MANGO_GAMEPAD_BT_MAC="$BT_MAC" bash "${SCRIPT_DIR}/connect-gamepad.sh" 2>/dev/null || true

mkdir -p "${HOME_DIR}/.config/systemd/user"
install -m 0644 -o "$USER_NAME" -g "$USER_NAME" "$UNIT_SRC" "$UNIT_DST"

run_user_systemctl daemon-reload
run_user_systemctl enable mango-tv-pad.service
run_user_systemctl start mango-tv-pad.service || true

if ! loginctl show-user "$USER_NAME" -p Linger 2>/dev/null | grep -q yes; then
  loginctl enable-linger "$USER_NAME"
  echo "✓ linger enabled for ${USER_NAME} (systemd user units survive logout)"
fi

echo
echo "✓ Pad auto-reconnect installed"
echo "  udev: $UDEV_RULE"
echo "  systemd: mango-tv-pad.service (user)"
echo
echo "After this, wake the Micro with any button — pad should recover without SSH."
echo "Log: /tmp/mango-tv-pad.log · udev: ${HOME_DIR}/.cache/mango/pad-udev.log"

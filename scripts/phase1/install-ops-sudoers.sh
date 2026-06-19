#!/usr/bin/env bash
# One-time: passwordless reboot/shutdown for mango ops (SSH from Mac).
# Run on the Pi interactively: sudo bash scripts/phase1/install-ops-sudoers.sh

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run: sudo bash $0" >&2
  exit 1
fi

USER_NAME="${SUDO_USER:-aman}"
FILE="/etc/sudoers.d/mango-ops"

cat >"$FILE" <<EOF
# mango ops — ${USER_NAME}@mango (installed $(date -u +%Y-%m-%d))
Defaults:${USER_NAME} !requiretty
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/sbin/reboot
${USER_NAME} ALL=(ALL) NOPASSWD: /sbin/reboot
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl reboot
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl poweroff
EOF

chmod 440 "$FILE"
visudo -cf "$FILE"
echo "✓ Installed $FILE"
echo "  Test: sudo -n reboot   # will reboot immediately — run only when intended"

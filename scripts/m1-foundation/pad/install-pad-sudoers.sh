#!/usr/bin/env bash
# One-time: passwordless sudo for mango TV pad (evdev grab + remapper stop).
# Run on the Pi interactively: sudo bash scripts/m1-foundation/pad/install-pad-sudoers.sh

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run: sudo bash $0" >&2
  exit 1
fi

USER_NAME="${MANGO_TV_USER:-${SUDO_USER:-${USER:?set MANGO_TV_USER}}}"
USER_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)"
USER_HOME="${USER_HOME:-/home/${USER_NAME}}"
PAD_RUN="${USER_HOME}/mango/scripts/m1-foundation/pad/run-mango-tv-pad.sh"
PAD_PY="${USER_HOME}/mango/scripts/m1-foundation/pad/mango-tv-pad.py"
FILE="/etc/sudoers.d/mango-tv-pad"

cat >"$FILE" <<EOF
# mango TV pad — ${USER_NAME}@mango (installed $(date -u +%Y-%m-%d))
Defaults:${USER_NAME} !requiretty
${USER_NAME} ALL=(ALL) NOPASSWD: ${PAD_RUN}
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/python3 ${PAD_PY}
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/pkill -f mango-tv-pad.py
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/pkill -f input-remapper-reader-service
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop input-remapper
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl start input-remapper
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/input-remapper-control *
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/chmod [0-9]* /dev/input/js*
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl start mango-controller-link.service
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart mango-controller-link.service
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl kill --signal=USR1 mango-controller-link.service
${USER_NAME} ALL=(ALL) NOPASSWD: /usr/bin/systemctl kill --signal=USR2 mango-controller-link.service
EOF

chmod 440 "$FILE"
chmod +x "$PAD_RUN"
visudo -cf "$FILE"
echo "✓ Installed $FILE"
echo "  Test: sudo -n ${PAD_RUN} --help 2>/dev/null || sudo -n true && echo sudo ok"

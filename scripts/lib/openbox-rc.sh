#!/usr/bin/env bash
# Ensure ~/.config/openbox/rc.xml exists by seeding from system Openbox defaults.

set -euo pipefail

OPENBOX_DIR="${HOME}/.config/openbox"
RC_FILE="${OPENBOX_DIR}/rc.xml"

SYSTEM_RC_CANDIDATES=(
  /etc/xdg/openbox/rc.xml
  /etc/xdg/openbox/lxde-rc.xml
  /usr/share/openbox/debian-rc.xml
  /usr/share/openbox/rc.xml
)

ensure_user_openbox_rc() {
  mkdir -p "$OPENBOX_DIR"

  if [[ -f "$RC_FILE" ]]; then
    return 0
  fi

  local candidate
  for candidate in "${SYSTEM_RC_CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
      cp "$candidate" "$RC_FILE"
      echo "Seeded $RC_FILE from $candidate"
      return 0
    fi
  done

  echo "! Could not find a system Openbox rc.xml to copy." >&2
  echo "  Checked: ${SYSTEM_RC_CANDIDATES[*]}" >&2
  echo "  Is Openbox running? Try: pgrep -a openbox" >&2
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ensure_user_openbox_rc
fi

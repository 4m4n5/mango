#!/usr/bin/env bash
# Resolve and seed the Openbox rc file Pi OS actually uses (often rpd-rc.xml).

set -euo pipefail

OPENBOX_DIR="${HOME}/.config/openbox"

SYSTEM_RC_CANDIDATES=(
  /etc/xdg/openbox/rpd-rc.xml
  /etc/xdg/openbox/rc.xml
  /etc/xdg/openbox/lxde-rc.xml
  /usr/share/openbox/debian-rc.xml
  /usr/share/openbox/rc.xml
)

# Print the rc.xml path Openbox is configured to use.
mango_openbox_rc_file() {
  local running args config

  if pgrep -x openbox >/dev/null 2>&1; then
    args=$(ps -p "$(pgrep -x openbox | head -1)" -o args= 2>/dev/null || true)
    config=$(sed -n 's/.*--config-file \([^ ]*\).*/\1/p' <<<"$args")
    if [[ -n "$config" ]]; then
      echo "$config"
      return 0
    fi
  fi

  if [[ -f "${OPENBOX_DIR}/rpd-rc.xml" ]]; then
    echo "${OPENBOX_DIR}/rpd-rc.xml"
    return 0
  fi

  if [[ -f /etc/xdg/openbox/rpd-rc.xml ]]; then
    echo "${OPENBOX_DIR}/rpd-rc.xml"
    return 0
  fi

  if [[ -f "${OPENBOX_DIR}/rc.xml" ]]; then
    echo "${OPENBOX_DIR}/rc.xml"
    return 0
  fi

  echo "${OPENBOX_DIR}/rc.xml"
}

# Ensure the target rc file exists; seed from system templates when missing.
ensure_mango_openbox_rc() {
  local rc candidate

  mkdir -p "$OPENBOX_DIR"
  rc=$(mango_openbox_rc_file)

  if [[ -f "$rc" ]]; then
    echo "$rc"
    return 0
  fi

  for candidate in "${SYSTEM_RC_CANDIDATES[@]}"; do
    if [[ -f "$candidate" ]]; then
      cp "$candidate" "$rc"
      echo "Seeded $rc from $candidate" >&2
      echo "$rc"
      return 0
    fi
  done

  echo "! Could not find a system Openbox rc.xml to copy." >&2
  echo "  Is Openbox running? Try: pgrep -a openbox" >&2
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  ensure_mango_openbox_rc
fi

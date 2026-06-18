#!/usr/bin/env bash
# Install Phase 1 Openbox autostart (no global Escape — breaks Stremio Y-back).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/openbox-rc.sh
source "$SCRIPT_DIR/../lib/openbox-rc.sh"

OPENBOX_DIR="${HOME}/.config/openbox"
AUTOSTART_FILE="$OPENBOX_DIR/autostart"
START_LINE='bash ~/mango/scripts/phase1/start-mango-ui.sh &'
MARKER_BEGIN="# mango phase1 begin"
MARKER_END="# mango phase1 end"

mkdir -p "$OPENBOX_DIR"

RC_FILE=$(ensure_mango_openbox_rc)
echo "Using Openbox config: $RC_FILE"

if [[ -f "$AUTOSTART_FILE" ]]; then
  cp "$AUTOSTART_FILE" "${AUTOSTART_FILE}.bak.$(date +%Y%m%d%H%M%S)"
fi

if [[ ! -f "$AUTOSTART_FILE" ]]; then
  touch "$AUTOSTART_FILE"
fi

if ! grep -Fq "$MARKER_BEGIN" "$AUTOSTART_FILE"; then
  {
    echo
    echo "$MARKER_BEGIN"
    echo "$START_LINE"
    echo "$MARKER_END"
  } >>"$AUTOSTART_FILE"
fi

python3 - "$RC_FILE" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
text = re.sub(
    r"\s*<!-- mango phase1 begin -->.*?<!-- mango phase1 end -->",
    "",
    text,
    flags=re.S,
)
path.write_text(text)
PY

echo "Openbox autostart installed (home = Super+h via install-openbox-stremio-tv.sh)."

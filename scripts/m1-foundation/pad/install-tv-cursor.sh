#!/usr/bin/env bash
# TV polish: hide mouse cursor (Openbox + unclutter).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../../lib/openbox-rc.sh
source "$SCRIPT_DIR/../lib/openbox-rc.sh"

MARKER="<!-- mango cursor begin -->"

if ! command -v unclutter-xfixes >/dev/null 2>&1 && ! command -v unclutter >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    echo "Installing unclutter-xfixes..."
    sudo -n apt-get update -qq
    sudo -n apt-get install -y unclutter-xfixes || sudo -n apt-get install -y unclutter
  else
    echo "! unclutter not installed — run on Pi: sudo apt install unclutter-xfixes"
  fi
fi

RC_FILE=$(ensure_mango_openbox_rc)
echo "Using Openbox config: $RC_FILE"

python3 - "$RC_FILE" "$MARKER" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
marker = sys.argv[2]
text = path.read_text()

text = re.sub(
    re.escape(marker) + r".*?<!-- mango cursor end -->",
    "",
    text,
    flags=re.S,
)

if marker not in text:
    if re.search(r"<hideCursor>", text):
        text = re.sub(r"<hideCursor>\s*\w+\s*</hideCursor>", "<hideCursor>yes</hideCursor>", text, count=1)
    elif "<mouse>" in text:
        text = text.replace("<mouse>", "<mouse>\n    <hideCursor>yes</hideCursor>", 1)
    else:
        insert = f"""  {marker}
  <mouse>
    <hideCursor>yes</hideCursor>
  </mouse>
  <!-- mango cursor end -->
"""
        text = text.replace("<openbox_config>", "<openbox_config>\n" + insert, 1)

path.write_text(text)
PY

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

bash "$SCRIPT_DIR/../lib/mango-cursor.sh" hide 2>/dev/null || true
openbox --reconfigure 2>/dev/null || echo "! openbox --reconfigure skipped (no DISPLAY — run on TV session or set DISPLAY=:0)"

echo "✓ Cursor hidden (Openbox + unclutter)"

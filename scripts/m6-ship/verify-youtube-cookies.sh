#!/usr/bin/env bash
# Validate the Netscape YouTube cookie jar without printing cookie values.
set -euo pipefail

FILE="${MANGO_YTDLP_COOKIES:-/etc/mango/youtube-cookies.txt}"

if [[ ! -f "$FILE" ]]; then
  echo "FAIL: missing $FILE" >&2
  exit 1
fi

mode="$(python3 - "$FILE" <<'PY'
import os
import stat
import sys
print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))
PY
)"
if [[ "$mode" != "0o600" && "$mode" != "0600" ]]; then
  echo "WARN: $FILE mode is $mode (want 0600)" >&2
fi

python3 - "$FILE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(errors="replace")
if not text.strip():
    raise SystemExit("FAIL: cookie file is empty")
lines = text.splitlines()
header_ok = any(
    line.startswith("# Netscape HTTP Cookie File")
    or line.startswith("# HTTP Cookie File")
    for line in lines[:5]
)
if not header_ok:
    raise SystemExit("FAIL: not a Netscape cookie file")
hosts = 0
youtube = 0
for line in lines:
    if not line.strip() or line.startswith("#"):
        continue
    parts = line.split("\t")
    if len(parts) < 7:
        continue
    hosts += 1
    host = parts[0].lstrip(".").lower()
    if host.endswith("youtube.com") or host.endswith("google.com"):
        youtube += 1
if hosts < 1:
    raise SystemExit("FAIL: no cookie rows")
if youtube < 1:
    raise SystemExit("FAIL: no youtube.com/google.com cookie rows")
print(f"ok rows={hosts} youtube_or_google_hosts={youtube}")
PY

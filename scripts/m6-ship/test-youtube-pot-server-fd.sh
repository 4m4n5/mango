#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

BGUTIL_DIR="$TMP/bgutil"
DEST_DIR="$BGUTIL_DIR/server"
mkdir -p "$DEST_DIR/src" "$DEST_DIR/node_modules" "$TMP/cache"

cat >"$TMP/deno" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
marker="${TEST_FD_MARKER:?}"
if ( : <&200 ) 2>/dev/null; then
  echo "open" >"$marker"
else
  echo "closed" >"$marker"
fi
port=4416
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == "--port" ]]; then
    j=$((i + 1))
    port="${!j}"
    break
  fi
done
exec python3 - "$port" <<'PY'
import http.server
import socketserver
import sys

port = int(sys.argv[1])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/ping":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, format, *args):
        return

with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
    httpd.serve_forever()
PY
SH
chmod +x "$TMP/deno"

export TEST_FD_MARKER="$TMP/fd-marker"
printf '// test stub\n' >"$DEST_DIR/src/main.ts"

export MANGO_BGUTIL_DIR="$BGUTIL_DIR"
export MANGO_DENO="$TMP/deno"
export MANGO_BGUTIL_HTTP_PORT=4516
export MANGO_BGUTIL_HTTP_PID_FILE="$TMP/cache/bgutil.pid"
export MANGO_BGUTIL_HTTP_LOG="$TMP/cache/bgutil.log"

exec 200>"$TMP/playability-maintenance.lock"
bash "$ROOT/scripts/m6-ship/youtube-pot-server.sh" start >/dev/null

marker="$(python3 - "$TEST_FD_MARKER" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).read_text(encoding="utf-8").strip())
PY
)"
if [[ "$marker" != "closed" ]]; then
  echo "fd 200 leaked into detached youtube-pot-server child" >&2
  exit 1
fi

bash "$ROOT/scripts/m6-ship/youtube-pot-server.sh" stop >/dev/null
exec 200>&-
echo "PASS: youtube-pot-server closes inherited fd 200 before detach"

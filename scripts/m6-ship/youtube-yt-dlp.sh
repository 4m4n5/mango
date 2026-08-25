#!/usr/bin/env bash
# Wrapper used by catalog-service for native YouTube playback resolution.
# Deployment should run ensure-youtube-yt-dlp.sh first; playback itself must
# not block on network package installation.
#
# Only a transport-canaried active or previous slot may execute. A legacy or
# distro yt-dlp is never an implicit production fallback.

set -euo pipefail

SLOT_ROOT="${MANGO_YTDLP_SLOT_ROOT:-$HOME/.local/share/mango/ytdlp-slots}"
SLOT="${MANGO_YTDLP_SLOT:-active}"
case "$SLOT" in
  active | previous) ;;
  *)
    echo "youtube yt-dlp: invalid resolver slot $SLOT" >&2
    exit 2
    ;;
esac
SLOT_BIN="$SLOT_ROOT/$SLOT/venv/bin/yt-dlp"
DENO_BIN="${MANGO_DENO:-$HOME/.local/share/mango/deno/bin/deno}"

if [[ -x "$DENO_BIN" ]]; then
  export PATH="$(dirname "$DENO_BIN"):$PATH"
fi

slot_canaried() {
  local slot_root="$1"
  [[ -x "$slot_root/venv/bin/yt-dlp" && -f "$slot_root/meta.json" ]] || return 1
  python3 - "$slot_root/meta.json" "${MANGO_YTDLP_CHANNEL:-nightly}" "$slot_root" <<'PY'
import json
import math
import os
import pathlib
import sys

def interpreter_ok(script: pathlib.Path) -> bool:
    try:
        first = script.read_bytes().split(b"\n", 1)[0]
    except OSError:
        return False
    if not first.startswith(b"#!"):
        return True
    interp = first[2:].decode("utf-8", "replace").strip().split()[0]
    return bool(interp) and os.path.exists(interp)

try:
    if not interpreter_ok(pathlib.Path(sys.argv[3]) / "venv/bin/yt-dlp"):
        raise ValueError("stale venv shebang")
    meta = json.load(open(sys.argv[1], encoding="utf-8"))
    result = meta.get("canary_result") or {}
    total = float(result.get("total"))
    passed = float(result.get("passed"))
    required_total = float(result.get("required_total"))
    required_passed = float(result.get("required_passed"))
    dynamic_total = float(result.get("dynamic_total"))
    dynamic_passed = float(result.get("dynamic_passed"))
    ok = (
        isinstance(meta.get("revision"), str)
        and bool(meta["revision"].strip())
        and meta.get("channel") == sys.argv[2]
        and meta.get("ejs") is True
        and meta.get("js_runtime") in {"deno", "node"}
        and meta.get("canary") == "pass"
        and result.get("ok") is True
        and result.get("transport") is True
        and all(math.isfinite(value) for value in (
            total, passed, required_total, required_passed,
            dynamic_total, dynamic_passed,
        ))
        and total >= required_total
        and passed >= required_passed
        and passed <= total
        and required_total >= 3
        and required_passed == required_total
        and 0 <= dynamic_total <= required_total
        and dynamic_passed == dynamic_total
    )
except Exception:
    ok = False
raise SystemExit(0 if ok else 1)
PY
}

if slot_canaried "$SLOT_ROOT/$SLOT"; then
  exec "$SLOT_BIN" "$@"
fi

echo "youtube yt-dlp: $SLOT canaried resolver is unavailable" >&2
exit 1

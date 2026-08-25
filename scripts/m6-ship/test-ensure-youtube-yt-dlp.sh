#!/usr/bin/env bash
# Local fixture coverage for atomic yt-dlp slots and the playback wrapper.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export MANGO_YTDLP_SLOT_ROOT="$tmp/slots"
export MANGO_YTDLP_PLUGIN_DIR="$tmp/plugins"
export MANGO_YTDLP_REFRESH_REQUEST="$tmp/runtime-refresh.request"
export MANGO_YTDLP_TEST_MODE=1
export MANGO_YTDLP_INSTALL_DENO=0
export MANGO_YTDLP_UPDATE=0
export MANGO_YTDLP_ALLOW_SYSTEM=0
mkdir -p "$MANGO_YTDLP_SLOT_ROOT/active/venv/bin" "$MANGO_YTDLP_PLUGIN_DIR"
cat >"$MANGO_YTDLP_SLOT_ROOT/active/venv/bin/yt-dlp" <<'EOF'
#!/usr/bin/env bash
echo slot-active
exit 0
EOF
chmod +x "$MANGO_YTDLP_SLOT_ROOT/active/venv/bin/yt-dlp"
cat >"$MANGO_YTDLP_SLOT_ROOT/active/meta.json" <<'EOF'
{"revision":"active","channel":"nightly","ejs":true,"js_runtime":"deno","canary":"pass","canary_result":{"ok":true,"transport":true,"total":7,"passed":6,"required_total":6,"required_passed":6,"dynamic_total":3,"dynamic_passed":3}}
EOF

out="$("$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version)"
[[ "$out" == "slot-active" ]] || { echo "FAIL: wrapper did not prefer active slot" >&2; exit 1; }

mkdir -p "$MANGO_YTDLP_SLOT_ROOT/previous/venv/bin"
cat >"$MANGO_YTDLP_SLOT_ROOT/previous/venv/bin/yt-dlp" <<'EOF'
#!/usr/bin/env bash
echo slot-previous
exit 0
EOF
chmod +x "$MANGO_YTDLP_SLOT_ROOT/previous/venv/bin/yt-dlp"
cat >"$MANGO_YTDLP_SLOT_ROOT/previous/meta.json" <<'EOF'
{"revision":"previous","channel":"nightly","ejs":true,"js_runtime":"deno","canary":"pass","canary_result":{"ok":true,"transport":true,"total":7,"passed":6,"required_total":6,"required_passed":6,"dynamic_total":3,"dynamic_passed":3}}
EOF
out="$(MANGO_YTDLP_SLOT=previous "$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version)"
[[ "$out" == "slot-previous" ]] || { echo "FAIL: wrapper could not select previous slot" >&2; exit 1; }
cat >"$MANGO_YTDLP_SLOT_ROOT/previous/meta.json" <<'EOF'
{"revision":"previous","channel":"nightly","ejs":true,"js_runtime":"deno","canary":"pass","canary_result":{"ok":true,"transport":false,"total":7,"passed":6,"required_total":6,"required_passed":6,"dynamic_total":3,"dynamic_passed":3}}
EOF
if MANGO_YTDLP_SLOT=previous "$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version >/dev/null 2>&1; then
  echo "FAIL: wrapper executed a previous slot without transport proof" >&2
  exit 1
fi

cat >"$MANGO_YTDLP_SLOT_ROOT/active/venv/bin/yt-dlp" <<'EOF'
#!/usr/bin/env bash
echo active-failed >&2
exit 7
EOF
chmod +x "$MANGO_YTDLP_SLOT_ROOT/active/venv/bin/yt-dlp"
if "$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version >/dev/null 2>&1; then
  echo "FAIL: wrapper hid active resolver failure" >&2
  exit 1
fi

rm -rf "$MANGO_YTDLP_SLOT_ROOT/active"
mkdir -p "$tmp/legacy/bin"
cat >"$tmp/legacy/bin/yt-dlp" <<'EOF'
#!/usr/bin/env bash
echo legacy-venv
exit 0
EOF
if "$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version >/dev/null 2>&1; then
  echo "FAIL: wrapper used a non-canaried legacy resolver" >&2
  exit 1
fi

rm -rf "$MANGO_YTDLP_SLOT_ROOT"
rm -f "$MANGO_YTDLP_REFRESH_REQUEST"
fixture="$tmp/fixture-yt-dlp"
cat >"$fixture" <<'EOF'
#!/usr/bin/env bash
echo "${MANGO_YTDLP_TEST_REVISION:-fixture}"
EOF
chmod +x "$fixture"
export MANGO_YTDLP_TEST_BIN="$fixture"
export MANGO_YTDLP_CANARY_FIXTURE=pass
export MANGO_YTDLP_UPDATE=1
export MANGO_BGUTIL_UPDATE=0

MANGO_YTDLP_TEST_REVISION=fixture-1 \
  bash "$ROOT/scripts/m6-ship/youtube-runtime-refresh.sh" >/dev/null
revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/active/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
[[ "$revision" == "fixture-1" ]] \
  || { echo "FAIL: first canaried candidate was not promoted" >&2; exit 1; }

MANGO_YTDLP_TEST_REVISION=fixture-2 \
  bash "$ROOT/scripts/m6-ship/youtube-runtime-refresh.sh" >/dev/null
active_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/active/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
previous_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/previous/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
[[ "$active_revision" == "fixture-2" && "$previous_revision" == "fixture-1" ]] \
  || { echo "FAIL: promotion did not retain the previous slot" >&2; exit 1; }

export MANGO_YTDLP_CANARY_FIXTURE=fail
MANGO_YTDLP_TEST_REVISION=fixture-3 \
  bash "$ROOT/scripts/m6-ship/youtube-runtime-refresh.sh" >/dev/null 2>&1
active_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/active/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
[[ "$active_revision" == "fixture-2" ]] \
  || { echo "FAIL: failed candidate replaced the active slot" >&2; exit 1; }

printf 'resolver_exit=1\n' >"$MANGO_YTDLP_REFRESH_REQUEST"
export MANGO_YTDLP_CANARY_FIXTURE=revision
export MANGO_YTDLP_CANARY_PASS_REVISION=fixture-1
MANGO_YTDLP_TEST_REVISION=fixture-2 \
  bash "$ROOT/scripts/m6-ship/youtube-runtime-refresh.sh" >/dev/null 2>&1
active_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/active/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
previous_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/previous/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
[[ "$active_revision" == "fixture-1" && "$previous_revision" == "fixture-2" ]] \
  || { echo "FAIL: failed active slot did not roll back to canaried previous" >&2; exit 1; }

rm -f "$MANGO_YTDLP_REFRESH_REQUEST"
export MANGO_YTDLP_UPDATE=auto
export MANGO_YTDLP_UPDATE_INTERVAL_SEC=0
export MANGO_YTDLP_CANARY_PASS_REVISION=fixture-2
MANGO_YTDLP_TEST_REVISION=fixture-1 \
  bash "$ROOT/scripts/m6-ship/youtube-runtime-refresh.sh" >/dev/null 2>&1
active_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/active/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
previous_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/previous/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
[[ "$active_revision" == "fixture-2" && "$previous_revision" == "fixture-1" ]] \
  || { echo "FAIL: scheduled canary did not roll back a degraded active slot" >&2; exit 1; }

export MANGO_YTDLP_UPDATE=1
export MANGO_YTDLP_CANARY_PASS_REVISION=fixture-1
MANGO_YTDLP_TEST_REVISION=fixture-3 \
  bash "$ROOT/scripts/m6-ship/youtube-runtime-refresh.sh" >/dev/null 2>&1
active_revision="$(python3 - "$MANGO_YTDLP_SLOT_ROOT/active/meta.json" <<'PY'
import json
import sys
print(json.load(open(sys.argv[1], encoding="utf-8"))["revision"])
PY
)"
[[ "$active_revision" == "fixture-1" ]] \
  || { echo "FAIL: newer failed candidate hid a degraded active slot" >&2; exit 1; }

fake_bin="$tmp/fake-bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/pgrep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"mango-youtube-runtime-retry.timer"* ]]; then
  printf '%s\n' "$*" >>"$MANGO_YTDLP_TEST_SYSTEMCTL_LOG"
  exit 0
fi
exit 1
EOF
chmod +x "$fake_bin/pgrep" "$fake_bin/systemctl"
export MANGO_YTDLP_TEST_SYSTEMCTL_LOG="$tmp/systemctl.log"
printf 'resolver_exit=1\n' >"$MANGO_YTDLP_REFRESH_REQUEST"
set +e
PATH="$fake_bin:$PATH" bash "$ROOT/scripts/m6-ship/youtube-runtime-refresh.sh" >/dev/null 2>&1
deferred_rc=$?
set -e
[[ "$deferred_rc" == "75" ]] \
  || { echo "FAIL: active playback did not defer refresh" >&2; exit 1; }
[[ ! -f "$MANGO_YTDLP_REFRESH_REQUEST" ]] \
  || { echo "FAIL: scheduled retry left a hot path trigger" >&2; exit 1; }
retry_calls="$(<"$MANGO_YTDLP_TEST_SYSTEMCTL_LOG")"
[[ "$retry_calls" == *"restart mango-youtube-runtime-retry.timer"* ]] \
  || { echo "FAIL: deferred refresh did not arm retry timer" >&2; exit 1; }

echo "PASS: youtube yt-dlp slots"

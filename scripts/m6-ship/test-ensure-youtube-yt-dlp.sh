#!/usr/bin/env bash
# Local fixture coverage for atomic yt-dlp slots and the playback wrapper.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

export MANGO_YTDLP_SLOT_ROOT="$tmp/slots"
export MANGO_YTDLP_VENV="$tmp/legacy"
export MANGO_YTDLP_PLUGIN_DIR="$tmp/plugins"
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

out="$("$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version)"
[[ "$out" == "slot-active" ]] || { echo "FAIL: wrapper did not prefer active slot" >&2; exit 1; }

rm -rf "$MANGO_YTDLP_SLOT_ROOT/active"
mkdir -p "$MANGO_YTDLP_VENV/bin"
cat >"$MANGO_YTDLP_VENV/bin/yt-dlp" <<'EOF'
#!/usr/bin/env bash
echo legacy-venv
exit 0
EOF
chmod +x "$MANGO_YTDLP_VENV/bin/yt-dlp"
out="$("$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version)"
[[ "$out" == "legacy-venv" ]] || { echo "FAIL: wrapper did not fall back to legacy venv" >&2; exit 1; }

rm -rf "$MANGO_YTDLP_VENV"
if "$ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version >/dev/null 2>&1; then
  echo "FAIL: wrapper used a silent system binary" >&2
  exit 1
fi

echo "PASS: youtube yt-dlp slots"

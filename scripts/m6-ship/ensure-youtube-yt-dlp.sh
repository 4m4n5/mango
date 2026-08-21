#!/usr/bin/env bash
# Install/update Mango's isolated yt-dlp resolver for native YouTube playback.
#
# Debian's packaged yt-dlp can lag behind YouTube extractor changes. Keep the
# volatile resolver in a user-owned venv so repo deploys stay git-only and
# system packages stay untouched.

set -euo pipefail

VENV="${MANGO_YTDLP_VENV:-$HOME/.local/share/mango/ytdlp-venv}"
BIN="$VENV/bin/yt-dlp"
STAMP="$VENV/.mango-last-update"
INTERVAL_SEC="${MANGO_YTDLP_UPDATE_INTERVAL_SEC:-86400}"
# yt-dlp 2026.07+ refuses Node <22 and Deno <2.3 for YouTube JS challenges.
# Debian Node on the Pi is 20, so playback URLs 403 in ffmpeg/mpv without Deno.
DENO_DIR="${MANGO_DENO_DIR:-$HOME/.local/share/mango/deno}"
DENO_BIN="$DENO_DIR/bin/deno"
DENO_VERSION="${MANGO_DENO_VERSION:-2.9.5}"

mkdir -p "$(dirname "$VENV")"

now_epoch() {
  python3 - <<'PY'
import time
print(int(time.time()))
PY
}

stamp_epoch() {
  if [[ -f "$STAMP" ]]; then
    python3 - "$STAMP" <<'PY'
import os
import sys
try:
    print(int(os.path.getmtime(sys.argv[1])))
except OSError:
    print(0)
PY
  else
    echo 0
  fi
}

needs_update=0
if [[ ! -x "$BIN" ]]; then
  needs_update=1
elif [[ "${MANGO_YTDLP_UPDATE:-auto}" == "1" ]]; then
  needs_update=1
elif [[ "${MANGO_YTDLP_UPDATE:-auto}" != "0" ]]; then
  age=$(( $(now_epoch) - $(stamp_epoch) ))
  if [[ "$age" -ge "$INTERVAL_SEC" ]]; then
    needs_update=1
  fi
fi

if [[ "$needs_update" == "1" ]]; then
  python3 -m venv "$VENV"
  if "$VENV/bin/python" -m pip install --quiet --upgrade pip yt-dlp; then
    date +%s >"$STAMP"
  elif [[ -x "$BIN" ]]; then
    echo "youtube yt-dlp: update failed; keeping existing $("$BIN" --version)" >&2
  elif command -v yt-dlp >/dev/null 2>&1; then
    echo "youtube yt-dlp: venv install failed; falling back to system $(yt-dlp --version)" >&2
    exit 0
  else
    echo "youtube yt-dlp: install failed and no fallback yt-dlp exists" >&2
    exit 1
  fi
fi

deno_target() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    aarch64 | arm64) printf '%s\n' "aarch64-unknown-linux-gnu" ;;
    x86_64 | amd64) printf '%s\n' "x86_64-unknown-linux-gnu" ;;
    *)
      echo "youtube deno: unsupported arch $arch" >&2
      return 1
      ;;
  esac
}

deno_needs_install() {
  [[ "${MANGO_DENO_UPDATE:-auto}" == "0" ]] && return 1
  if [[ ! -x "$DENO_BIN" ]]; then
    return 0
  fi
  local current
  current="$("$DENO_BIN" --version 2>/dev/null | awk '/^deno / { print $2; exit }')"
  [[ "$current" != "$DENO_VERSION" ]]
}

install_deno() {
  local target zip tmp sha_file
  target="$(deno_target)" || return 1
  command -v unzip >/dev/null 2>&1 || {
    echo "youtube deno: unzip is required to install Deno" >&2
    return 1
  }
  mkdir -p "$DENO_DIR/bin"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/mango-deno.XXXXXX")"
  zip="$tmp/deno.zip"
  sha_file="$tmp/deno.zip.sha256"
  if ! curl -fsSL --retry 3 --retry-delay 2 --max-time 180 \
    "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${target}.zip" \
    -o "$zip"; then
    rm -rf "$tmp"
    echo "youtube deno: download failed for v${DENO_VERSION} ${target}" >&2
    return 1
  fi
  if curl -fsSL --max-time 30 \
    "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${target}.zip.sha256sum" \
    -o "$sha_file"; then
    # GitHub checksum file is "<hash>  <filename>". Hash the downloaded zip.
    local expected actual
    expected="$(awk '{ print $1 }' "$sha_file")"
    actual="$(sha256sum "$zip" | awk '{ print $1 }')"
    if [[ -n "$expected" && "$expected" != "$actual" ]]; then
      rm -rf "$tmp"
      echo "youtube deno: checksum mismatch for v${DENO_VERSION}" >&2
      return 1
    fi
  fi
  unzip -qo "$zip" -d "$tmp" || {
    rm -rf "$tmp"
    echo "youtube deno: unzip failed" >&2
    return 1
  }
  install -m 0755 "$tmp/deno" "$DENO_BIN"
  rm -rf "$tmp"
  echo "youtube deno: $("$DENO_BIN" --version | awk '/^deno / { print $2; exit }') ($DENO_BIN)"
}

if deno_needs_install; then
  install_deno || echo "youtube deno: install failed; YouTube playback needs deno>=2.3 or node>=22" >&2
elif [[ -x "$DENO_BIN" ]]; then
  echo "youtube deno: $("$DENO_BIN" --version | awk '/^deno / { print $2; exit }') ($DENO_BIN)"
fi

if [[ -x "$BIN" ]]; then
  "$VENV/bin/python" -m pip install --quiet --upgrade bgutil-ytdlp-pot-provider \
    || echo "youtube pot: plugin install failed; mweb GVS URLs will 403 without a PO token" >&2
fi

install_bgutil_server() {
  local dest version
  dest="${MANGO_BGUTIL_DIR:-$HOME/.local/share/mango/bgutil-pot}"
  version="${MANGO_BGUTIL_VERSION:-1.3.1}"
  [[ "${MANGO_BGUTIL_UPDATE:-auto}" == "0" ]] && return 0
  command -v git >/dev/null 2>&1 || {
    echo "youtube pot: git is required to install bgutil" >&2
    return 1
  }
  if [[ ! -d "$dest/.git" ]]; then
    git clone --depth 1 --branch "$version" \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$dest" || return 1
  fi
  if [[ -x "$DENO_BIN" && ! -d "$dest/server/node_modules" ]]; then
    (
      cd "$dest/server"
      PATH="$(dirname "$DENO_BIN"):$PATH" deno install --frozen --allow-scripts=npm:canvas
    ) || {
      echo "youtube pot: deno install failed in $dest/server" >&2
      return 1
    }
  fi
  echo "youtube pot: bgutil $version ($dest)"
}

install_bgutil_server || true

if [[ -x "$BIN" ]]; then
  echo "youtube yt-dlp: $("$BIN" --version) ($BIN)"
elif command -v yt-dlp >/dev/null 2>&1; then
  echo "youtube yt-dlp: system $(yt-dlp --version) ($(command -v yt-dlp))"
fi

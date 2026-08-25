#!/usr/bin/env bash
# Install/update Mango's isolated yt-dlp resolver for native YouTube playback.
#
# Debian's packaged yt-dlp can lag behind YouTube extractor changes. Keep the
# volatile resolver in a user-owned venv so repo deploys stay git-only and
# system packages stay untouched.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLOT_ROOT="${MANGO_YTDLP_SLOT_ROOT:-$HOME/.local/share/mango/ytdlp-slots}"
BIN="$SLOT_ROOT/active/venv/bin/yt-dlp"
REFRESH="$SCRIPT_DIR/youtube-runtime-refresh.sh"
REFRESH_REQUEST="${MANGO_YTDLP_REFRESH_REQUEST:-$HOME/.cache/mango/youtube-runtime-refresh.request}"
# yt-dlp 2026.07+ refuses Node <22 and Deno <2.3 for YouTube JS challenges.
# Debian Node on the Pi is 20, so playback URLs 403 in ffmpeg/mpv without Deno.
DENO_DIR="${MANGO_DENO_DIR:-$HOME/.local/share/mango/deno}"
DENO_BIN="$DENO_DIR/bin/deno"
DENO_VERSION="${MANGO_DENO_VERSION:-2.9.5}"

mkdir -p "$DENO_DIR"

schedule_deferred_refresh() {
  if command -v systemctl >/dev/null 2>&1 \
    && systemctl --user cat mango-youtube-runtime-retry.timer >/dev/null 2>&1 \
    && systemctl --user restart mango-youtube-runtime-retry.timer; then
    rm -f "$REFRESH_REQUEST"
    return 0
  fi
  return 1
}

if [[ "${MANGO_YTDLP_ALLOW_DURING_PLAYBACK:-0}" != "1" ]] \
  && command -v pgrep >/dev/null 2>&1 \
  && pgrep -x mpv >/dev/null 2>&1; then
  schedule_deferred_refresh || true
  echo "youtube runtime: maintenance deferred while mpv is active"
  exit 0
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

set +e
bash "$REFRESH"
refresh_rc=$?
set -e
if [[ "$refresh_rc" == "75" ]]; then
  exit 0
fi
if [[ "$refresh_rc" != "0" ]]; then
  exit "$refresh_rc"
fi

install_bgutil_server() {
  local dest version
  dest="${MANGO_BGUTIL_DIR:-$HOME/.local/share/mango/bgutil-pot}"
  version="${MANGO_BGUTIL_VERSION:-}"
  if [[ -z "$version" && -f "$SLOT_ROOT/active/meta.json" ]]; then
    version="$(python3 - "$SLOT_ROOT/active/meta.json" <<'PY'
import json
import sys
try:
    print(str(json.load(open(sys.argv[1], encoding="utf-8")).get("pot_plugin_version") or ""))
except Exception:
    print("")
PY
)"
  fi
  version="${version:-1.3.2}"
  [[ "$version" == "missing" || "$version" == "test" ]] && return 0
  [[ "${MANGO_BGUTIL_UPDATE:-auto}" == "0" ]] && return 0
  command -v git >/dev/null 2>&1 || {
    echo "youtube pot: git is required to install bgutil" >&2
    return 1
  }
  if [[ ! -d "$dest/.git" ]]; then
    git clone --depth 1 --branch "$version" \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$dest" || return 1
  elif [[ "$(git -C "$dest" describe --tags --exact-match 2>/dev/null || true)" != "$version" ]]; then
    git -C "$dest" fetch --force --depth 1 origin \
      "refs/tags/${version}:refs/tags/${version}" || return 1
    git -C "$dest" checkout --force --detach "$version" || return 1
  fi
  # bgutil 1.x listens on every interface. Mango's provider is a local
  # capability and must never be reachable from the household LAN.
  python3 - "$dest/server/src/main.ts" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
source = path.read_text(encoding="utf-8")
source = re.sub(
    r"""host\s*:\s*["'](?:::|0\.0\.0\.0)["']\s*,""",
    'host: "127.0.0.1",',
    source,
)
if re.search(r"""host\s*:\s*["'](?:::|0\.0\.0\.0)["']""", source):
    raise SystemExit("youtube pot: unsafe wildcard listener remains")
if not any(host in source for host in (
    'host: "127.0.0.1",',
    'host: "localhost",',
    'host: "::1",',
)):
    raise SystemExit("youtube pot: could not enforce loopback listener")
path.write_text(source, encoding="utf-8")
PY
  local installed_version=""
  [[ -f "$dest/server/.mango-installed-version" ]] \
    && installed_version="$(tr -d '[:space:]' <"$dest/server/.mango-installed-version")"
  if [[ -x "$DENO_BIN" && ( ! -d "$dest/server/node_modules" || "$installed_version" != "$version" ) ]]; then
    (
      cd "$dest/server"
      PATH="$(dirname "$DENO_BIN"):$PATH" deno install --frozen --allow-scripts=npm:canvas
      printf '%s\n' "$version" >.mango-installed-version
    ) || {
      echo "youtube pot: deno install failed in $dest/server" >&2
      return 1
    }
  fi
  echo "youtube pot: bgutil $version ($dest)"
}

pot_enabled() {
  [[ "${MANGO_YOUTUBE_POT:-1}" != "0" ]]
}

if pot_enabled; then
  if ! install_bgutil_server; then
    echo "youtube pot: install failed while POT support is enabled" >&2
    exit 1
  fi
  if command -v systemctl >/dev/null 2>&1 \
    && systemctl --user is-active --quiet mango-youtube-pot.service 2>/dev/null; then
    systemctl --user restart mango-youtube-pot.service
    pot_ready=0
    for _ in $(seq 1 20); do
      if bash "$SCRIPT_DIR/youtube-pot-server.sh" status >/dev/null 2>&1; then
        pot_ready=1
        break
      fi
      sleep 0.25
    done
    if [[ "$pot_ready" != "1" ]]; then
      echo "youtube pot: supervised provider failed readiness after update" >&2
      exit 1
    fi
  fi
else
  echo "youtube pot: disabled by MANGO_YOUTUBE_POT=0"
fi

if [[ -x "$BIN" ]]; then
  echo "youtube yt-dlp: $("$BIN" --version) ($BIN, canaried)"
elif command -v yt-dlp >/dev/null 2>&1; then
  echo "youtube yt-dlp: no canaried slot; system $(yt-dlp --version) is not release-ready" >&2
fi

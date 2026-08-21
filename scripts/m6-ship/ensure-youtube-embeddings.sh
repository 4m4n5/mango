#!/usr/bin/env bash
# Download the YouTube MiniLM embedding model and optionally turn ranking on.
#
#   bash scripts/m6-ship/ensure-youtube-embeddings.sh
#   bash scripts/m6-ship/ensure-youtube-embeddings.sh --enable
#
# --enable upserts MANGO_YOUTUBE_EMBEDDINGS=1 and MANGO_YOUTUBE_SIM=blend in
# ~/.config/mango/voice.env (mode 0600). It does not print the file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${MANGO_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
CATALOG_DIR="$REPO_DIR/src/catalog-service"
CACHE_DIR="${MANGO_EMBEDDINGS_CACHE:-$HOME/.local/share/mango/embeddings}"
VOICE_ENV="${MANGO_VOICE_ENV:-$HOME/.config/mango/voice.env}"
ENABLE=0

usage() {
  cat >&2 <<'EOF'
usage: ensure-youtube-embeddings.sh [--enable]

Download Xenova/all-MiniLM-L6-v2 into ~/.local/share/mango/embeddings.
--enable  also set MANGO_YOUTUBE_EMBEDDINGS=1 and MANGO_YOUTUBE_SIM=blend
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --enable) ENABLE=1; shift ;;
    -h | --help) usage ;;
    *) usage ;;
  esac
done

if [[ ! -d "$CATALOG_DIR/node_modules/@huggingface/transformers" ]]; then
  echo "youtube embeddings: installing catalog-service dependencies" >&2
  if [[ -f "$REPO_DIR/scripts/lib/pi-npm-deps.sh" ]]; then
    (
      cd "$REPO_DIR"
      bash "$REPO_DIR/scripts/lib/pi-npm-deps.sh" ensure src/catalog-service
    )
  else
    npm --prefix "$CATALOG_DIR" ci
  fi
fi

if [[ ! -d "$CATALOG_DIR/node_modules/@huggingface/transformers" ]]; then
  echo "youtube embeddings: @huggingface/transformers missing after install" >&2
  exit 1
fi

export MANGO_EMBEDDINGS_CACHE="$CACHE_DIR"
(
  cd "$CATALOG_DIR"
  node scripts/ensure-embeddings.mjs
)

upsert_voice_env() {
  local key="$1" value="$2" out
  mkdir -p "$(dirname "$VOICE_ENV")"
  touch "$VOICE_ENV"
  out="$(mktemp)"
  grep -vE "^export ${key}=" "$VOICE_ENV" >"$out" || true
  printf 'export %s=%s\n' "$key" "$value" >>"$out"
  mv "$out" "$VOICE_ENV"
  chmod 600 "$VOICE_ENV" 2>/dev/null || true
}

if [[ "$ENABLE" == "1" ]]; then
  upsert_voice_env MANGO_YOUTUBE_EMBEDDINGS 1
  upsert_voice_env MANGO_YOUTUBE_SIM blend
  echo "youtube embeddings: ranking flags set (embeddings=1, sim=blend)"
fi

echo "youtube embeddings: model cache $CACHE_DIR"

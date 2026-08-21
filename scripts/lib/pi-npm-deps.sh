#!/usr/bin/env bash
# Pi: install node deps only when package-lock.json changes (fast deploy path).
# Usage: bash scripts/lib/pi-npm-deps.sh ensure <dir>
#        bash scripts/lib/pi-npm-deps.sh build <dir>   # ensure + npm run build

set -euo pipefail

CACHE_DIR="${HOME}/.cache/mango"

stamp_path() {
  local dir="$1"
  local key="${dir//\//-}"
  echo "${CACHE_DIR}/npm-lock-stamp-${key}"
}

lock_hash() {
  local dir="$1"
  local lock="${dir}/package-lock.json"
  if [[ ! -f "$lock" ]]; then
    echo "missing"
    return
  fi
  sha256sum "$lock" | awk '{print $1}'
}

ensure_deps() {
  local dir="$1"
  [[ -f "${dir}/package.json" ]] || { echo "pi-npm-deps: no package.json in $dir" >&2; return 1; }

  local lock="${dir}/package-lock.json"
  if [[ ! -f "$lock" ]]; then
    echo "pi-npm-deps: npm install ($dir — no lockfile)"
    npm --prefix "$dir" install --silent
    return 0
  fi

  local stamp hash
  stamp="$(stamp_path "$dir")"
  hash="$(lock_hash "$dir")"
  mkdir -p "$CACHE_DIR"

  if [[ -d "${dir}/node_modules" ]] && [[ -f "$stamp" ]] && [[ "$(tr -d '[:space:]' <"$stamp")" == "$hash" ]]; then
    echo "pi-npm-deps: deps ok ($dir)"
    return 0
  fi

  echo "pi-npm-deps: npm ci ($dir — lock changed or node_modules missing)"
  npm --prefix "$dir" ci --silent
  printf '%s\n' "$hash" >"$stamp"
}

build_pkg() {
  local dir="$1"
  ensure_deps "$dir"
  npm --prefix "$dir" run build
}

case "${1:-}" in
  ensure) ensure_deps "${2:?dir required}" ;;
  build) build_pkg "${2:?dir required}" ;;
  *)
    echo "usage: $0 ensure|build <dir>" >&2
    exit 2
    ;;
esac

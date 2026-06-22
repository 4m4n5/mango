#!/usr/bin/env bash
# Shared NexoTV helpers for mango live TV.

nexotv_base_url() {
  echo "${MANGO_NEXOTV_URL:-http://127.0.0.1:7000}"
}

nexotv_free_base_url() {
  echo "${MANGO_NEXOTV_FREE_URL:-http://127.0.0.1:7001}"
}

nexotv_news_base_url() {
  echo "${MANGO_NEXOTV_NEWS_URL:-http://127.0.0.1:7002}"
}

nexotv_cartoons_base_url() {
  echo "${MANGO_NEXOTV_CARTOONS_URL:-http://127.0.0.1:7003}"
}

nexotv_profiles_file() {
  echo "${MANGO_NEXOTV_PROFILES:-${HOME}/.config/mango/nexotv-profiles.json}"
}

nexotv_credentials_file() {
  echo "${MANGO_NEXOTV_CREDS:-${HOME}/.config/mango/nexotv.credentials}"
}

nexotv_free_credentials_file() {
  echo "${MANGO_NEXOTV_FREE_CREDS:-${HOME}/.config/mango/nexotv-free.credentials}"
}

nexotv_news_credentials_file() {
  echo "${MANGO_NEXOTV_NEWS_CREDS:-${HOME}/.config/mango/nexotv-news.credentials}"
}

nexotv_cartoons_credentials_file() {
  echo "${MANGO_NEXOTV_CARTOONS_CREDS:-${HOME}/.config/mango/nexotv-cartoons.credentials}"
}

nexotv_export_file() {
  echo "${MANGO_STREMIO_EXPORT:-/etc/mango/stremio-export.json}"
}

nexotv_health_ok() {
  curl -sf --max-time 5 "$(nexotv_base_url)/health" >/dev/null 2>&1
}

nexotv_free_health_ok() {
  curl -sf --max-time 5 "$(nexotv_free_base_url)/health" >/dev/null 2>&1
}

nexotv_news_health_ok() {
  curl -sf --max-time 5 "$(nexotv_news_base_url)/health" >/dev/null 2>&1
}

nexotv_cartoons_health_ok() {
  curl -sf --max-time 5 "$(nexotv_cartoons_base_url)/health" >/dev/null 2>&1
}

nexotv_load_credentials() {
  local creds
  creds="$(nexotv_credentials_file)"
  [[ -f "$creds" ]] || return 1
  # shellcheck disable=SC1090
  source "$creds"
  [[ -n "${NEXOTV_TOKEN:-}" && -n "${NEXOTV_MANIFEST_URL:-}" ]]
}

nexotv_manifest_url() {
  if nexotv_load_credentials; then
    printf '%s\n' "$NEXOTV_MANIFEST_URL"
    return 0
  fi
  return 1
}

nexotv_catalog_url() {
  local skip="${1:-0}"
  local manifest base token
  manifest="$(nexotv_manifest_url)" || return 1
  base="${manifest%/manifest.json}"
  token="${base##*/}"
  printf '%s/catalog/tv/iptv_channels/skip=%s.json\n' "$(nexotv_base_url)/${token}" "$skip"
}

nexotv_stream_url() {
  local id="$1"
  local manifest base token
  manifest="$(nexotv_manifest_url)" || return 1
  base="${manifest%/manifest.json}"
  token="${base##*/}"
  python3 - "$base" "$id" <<'PY'
import sys
from urllib.parse import quote
base, item_id = sys.argv[1], sys.argv[2]
print(f"{base}/stream/tv/{quote(item_id, safe='')}.json")
PY
}

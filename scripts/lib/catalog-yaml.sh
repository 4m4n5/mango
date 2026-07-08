# Shared catalog config resolution — repo example when /etc differs (Mac dev / Pi drift).
# shellcheck shell=bash

resolve_catalog_yaml() {
  local etc="/etc/mango/catalog.yaml"
  local example="${REPO_DIR:?REPO_DIR}/config/catalog.example.yaml"
  if [[ -n "${MANGO_CATALOG_YAML:-}" ]]; then
    printf '%s\n' "$MANGO_CATALOG_YAML"
    return 0
  fi
  if [[ -f "$example" && -f "$etc" ]] && ! cmp -s "$example" "$etc"; then
    echo "catalog: /etc/mango/catalog.yaml differs from repo — using config/catalog.example.yaml" >&2
    echo "catalog: sync with: sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml" >&2
    printf '%s\n' "$example"
    return 0
  fi
  if [[ -f "$etc" ]]; then
    printf '%s\n' "$etc"
    return 0
  fi
  if [[ -f "$example" ]]; then
    printf '%s\n' "$example"
    return 0
  fi
  echo "catalog: no catalog.yaml (expected /etc/mango/catalog.yaml or config/catalog.example.yaml)" >&2
  return 1
}

resolve_catalog_filters() {
  local etc="/etc/mango/catalog-filters.json"
  local example="${REPO_DIR:?REPO_DIR}/config/catalog-filters.example.json"
  if [[ -n "${MANGO_CATALOG_FILTERS:-}" ]]; then
    printf '%s\n' "$MANGO_CATALOG_FILTERS"
    return 0
  fi
  if [[ -f "$example" && -f "$etc" ]] && ! cmp -s "$example" "$etc"; then
    echo "catalog: /etc/mango/catalog-filters.json differs from repo — using config/catalog-filters.example.json" >&2
    echo "catalog: sync with: bash scripts/lib/sync-catalog-filters-etc.sh" >&2
    printf '%s\n' "$example"
    return 0
  fi
  if [[ -f "$etc" ]]; then
    printf '%s\n' "$etc"
    return 0
  fi
  if [[ -f "$example" ]]; then
    printf '%s\n' "$example"
    return 0
  fi
  printf '%s\n' "$etc"
}

# Mirror the active couch stream policy into /etc/mango so catalog-service and
# manual restarts cannot silently fall back to a stale 1080p-only file.
sync_catalog_filters_etc() {
  local etc="/etc/mango/catalog-filters.json"
  local src="${1:-}"
  if [[ -z "$src" ]]; then
    if [[ -n "${MANGO_CATALOG_FILTERS:-}" && -f "${MANGO_CATALOG_FILTERS}" ]]; then
      src="${MANGO_CATALOG_FILTERS}"
    elif [[ -f "${REPO_DIR:?REPO_DIR}/config/catalog-filters.example.json" ]]; then
      src="${REPO_DIR}/config/catalog-filters.example.json"
    fi
  fi
  [[ -n "$src" ]] || {
    echo "sync-catalog-filters: no source profile found" >&2
    return 1
  }
  mkdir -p "$(dirname "$etc")"
  if [[ -f "$etc" ]] && cmp -s "$src" "$etc"; then
    echo "sync-catalog-filters: $etc already matches $(basename "$src")"
    return 0
  fi
  if cp "$src" "$etc" 2>/dev/null; then
    chmod 600 "$etc" 2>/dev/null || true
    echo "sync-catalog-filters: synced $(basename "$src") -> $etc"
    return 0
  fi
  if sudo -n cp "$src" "$etc" 2>/dev/null; then
    echo "sync-catalog-filters: synced $(basename "$src") -> $etc (sudo)"
    return 0
  fi
  echo "sync-catalog-filters: failed to write $etc" >&2
  return 1
}

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
    echo "catalog: sync with: sudo cp config/catalog-filters.example.json /etc/mango/catalog-filters.json" >&2
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

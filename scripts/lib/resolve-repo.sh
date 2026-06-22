# Resolve mango repo root from any script depth.
# Usage: source scripts/lib/resolve-repo.sh && mango_resolve_repo_dir
mango_resolve_repo_dir() {
  if [[ -n "${MANGO_REPO_DIR:-}" ]]; then
    printf '%s' "$MANGO_REPO_DIR"
    return 0
  fi
  local d
  d="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd)"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/AGENTS.md" && -d "$d/scripts/lib" ]]; then
      printf '%s' "$d"
      return 0
    fi
    d="$(dirname "$d")"
  done
  printf '%s' "${HOME}/mango"
}

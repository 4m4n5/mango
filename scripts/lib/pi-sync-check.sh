#!/usr/bin/env bash
# Fail fast when Pi deploy references files not yet on origin.
# Git-only deploy: commit + push from Mac, then git pull on Pi — never rsync.
# Usage: bash scripts/lib/pi-sync-check.sh scripts/m1-foundation/pad/install-pad-autoreconnect.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -eq 0 ]]; then
  echo "usage: bash scripts/lib/pi-sync-check.sh <repo-path>..." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
missing=()
unpushed=()

for path in "$@"; do
  if [[ ! -f "$path" ]]; then
    missing+=("$path")
    continue
  fi
  if ! git ls-files --error-unmatch "$path" &>/dev/null; then
    unpushed+=("$path (untracked)")
    continue
  fi
  if ! git diff --quiet HEAD -- "$path" 2>/dev/null; then
    unpushed+=("$path (uncommitted)")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  printf '✗ missing locally:\n' >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

if [[ ${#unpushed[@]} -gt 0 ]]; then
  printf '✗ not committed — push from Mac before Pi git pull:\n' >&2
  printf '  - %s\n' "${unpushed[@]}" >&2
  exit 1
fi

git fetch origin "$branch" 2>/dev/null || true
remote="origin/${branch}"
if ! git rev-parse --verify "$remote" &>/dev/null; then
  echo "✗ no $remote — git push -u origin $branch" >&2
  exit 1
fi

for path in "$@"; do
  if ! git cat-file -e "${remote}:${path}" 2>/dev/null; then
    unpushed+=("$path (not on $remote)")
  fi
done

if [[ ${#unpushed[@]} -gt 0 ]]; then
  printf '✗ not on Pi remote yet — commit and git push from Mac:\n' >&2
  printf '  - %s\n' "${unpushed[@]}" >&2
  exit 1
fi

printf '✓ Pi can git pull: %s\n' "$*"

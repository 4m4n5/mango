#!/usr/bin/env bash
# Shared fail-closed checks for Mac→Pi git deploy. Sourced by pi-deploy.sh
# and pi-exec-gate.sh. Never rsync.

mango_required_deploy_branch() {
  printf '%s\n' "${MANGO_REQUIRED_BRANCH:-feat/native-experience}"
}

mango_refuse_unexpected_dirty() {
  local repo="$1"
  local label="$2"
  local dirty
  dirty="$(git -C "$repo" status --porcelain)"
  if [[ -z "$dirty" ]]; then
    return 0
  fi
  if [[ "${MANGO_DEPLOY_ALLOW_DIRTY:-0}" == "1" ]]; then
    echo "$label dirty tree allowed by MANGO_DEPLOY_ALLOW_DIRTY=1" >&2
    return 0
  fi
  echo "$label has uncommitted changes — commit/push or set MANGO_DEPLOY_ALLOW_DIRTY=1 after review" >&2
  echo "$dirty" >&2
  return 1
}

mango_require_deploy_branch() {
  local branch="$1"
  local required
  required="$(mango_required_deploy_branch)"
  if [[ "$branch" != "$required" ]]; then
    echo "deploy refused: branch ${branch:-unset} is not ${required}" >&2
    return 1
  fi
}

mango_fetch_origin_branch() {
  local repo="$1"
  local branch="$2"
  git -C "$repo" fetch origin "$branch"
}

mango_expected_deploy_sha() {
  local repo="$1"
  local branch="$2"
  if [[ -n "${MANGO_DEPLOY_SHA:-}" ]]; then
    git -C "$repo" rev-parse --verify "${MANGO_DEPLOY_SHA}^{commit}"
    return
  fi
  git -C "$repo" rev-parse --verify "origin/${branch}^{commit}"
}

mango_require_sha() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ -z "$actual" || -z "$expected" ]]; then
    echo "deploy refused: ${label} SHA missing (actual=${actual:-empty} expected=${expected:-empty})" >&2
    return 1
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "deploy refused: ${label} SHA ${actual} does not match expected ${expected}" >&2
    return 1
  fi
}

#!/usr/bin/env bash
# Deprecated wrapper — use playability-grow.sh --mode grow --preset quick
exec "$(dirname "$0")/playability-grow.sh" --mode grow --preset quick "$@"

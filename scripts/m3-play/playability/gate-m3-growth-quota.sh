#!/usr/bin/env bash
# Obsolete — pre grow_per_pass schema (growth_quota). Use gate-m3-library-grow.sh.
set -euo pipefail
echo "gate-m3-growth-quota: obsolete (growth_quota removed) — use gate-m3-library-grow.sh" >&2
exec bash "$(cd "$(dirname "$0")" && pwd)/gate-m3-library-grow.sh"

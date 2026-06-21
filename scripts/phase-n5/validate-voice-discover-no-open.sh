#!/usr/bin/env bash
# Discover utterances must not be treated as title navigation (no auto-open path).
# Usage: bash scripts/phase-n5/validate-voice-discover-no-open.sh

set -euo pipefail
exec bash "$(dirname "$0")/gate-n5c-conversation-policy.sh"

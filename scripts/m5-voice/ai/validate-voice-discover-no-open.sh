#!/usr/bin/env bash
# Discover utterances must not be treated as title navigation (no auto-open path).
# Usage: bash scripts/m5-voice/ai/validate-voice-discover-no-open.sh

set -euo pipefail
exec bash "$(dirname "$0")/gate-m5-conversation-policy.sh"

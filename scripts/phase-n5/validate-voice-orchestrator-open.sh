#!/usr/bin/env bash
# Orchestrator path: search → explicit hit open → launcher ack.
# Run on Pi. Requires catalog + launcher Chromium up.
#
# Usage: bash scripts/phase-n5/validate-voice-orchestrator-open.sh

set -euo pipefail
exec bash "$(dirname "$0")/validate-voice-clear-open.sh"

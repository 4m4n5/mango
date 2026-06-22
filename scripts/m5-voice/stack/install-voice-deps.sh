#!/usr/bin/env bash
# Install/check host voice dependencies for mango Phase 2.

set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  echo "Installing Pi/Linux voice system deps..."
  sudo apt-get update
  sudo apt-get install -y alsa-utils espeak-ng libasound2-dev mkcert pulseaudio-utils
elif command -v brew >/dev/null 2>&1; then
  echo "Installing Mac voice helper deps..."
  brew install mkcert
  echo "Install Piper/Whisper Python deps with: bash scripts/m5-voice/stack/install-orchestrator-deps.sh"
else
  echo "Install these manually: mkcert, espeak-ng, alsa-utils/aplay, pulseaudio-utils/pactl" >&2
fi

echo "✓ voice system dependency check complete"
echo "→ Piper voice: bash scripts/m5-voice/stack/download-piper-voice.sh"

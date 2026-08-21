# Canonical milestone script paths. Source: scripts/MILESTONES.md
# shellcheck shell=bash
mango_milestone_paths() {
  local root="${MANGO_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  MANGO_M1_GATE="$root/scripts/m1-foundation/gate"
  MANGO_M1_PAD="$root/scripts/m1-foundation/pad"
  MANGO_M1_UI="$root/scripts/m1-foundation/ui"
  MANGO_M2_SERVICE="$root/scripts/m2-catalog/service"
  MANGO_M2_BROWSE="$root/scripts/m2-catalog/browse"
  MANGO_M2_RAILS="$root/scripts/m2-catalog/rails"
  MANGO_M3_DETAIL="$root/scripts/m3-play/detail"
  MANGO_M3_ORCH="$root/scripts/m3-play/orchestrator"
  MANGO_M3_PLAYABILITY="$root/scripts/m3-play/playability"
  MANGO_M4_ADDONS="$root/scripts/m4-addons"
  MANGO_M5_VOICE="$root/scripts/m5-voice/stack"
  MANGO_M5_AI="$root/scripts/m5-voice/ai"
  MANGO_LIVE="$root/scripts/live"
}

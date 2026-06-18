#!/usr/bin/env bash
# Best-effort TV screenshot capture for N0 gates.

set -euo pipefail

LABEL="${1:-launcher-idle}"
SHOT_DIR="${MANGO_GATE_SHOT_DIR:-$HOME/.cache/mango/gate-screenshots}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$SHOT_DIR/${LABEL}-${TS}.png"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

mkdir -p "$SHOT_DIR"

if command -v scrot >/dev/null 2>&1; then
  scrot "$OUT"
elif command -v import >/dev/null 2>&1; then
  import -window root "$OUT"
elif command -v xwd >/dev/null 2>&1 && command -v convert >/dev/null 2>&1; then
  TMP="$SHOT_DIR/${LABEL}-${TS}.xwd"
  xwd -root -out "$TMP"
  convert "$TMP" "$OUT"
  rm -f "$TMP"
else
  echo "no screenshot tool available (install scrot or imagemagick)" >&2
  exit 3
fi

echo "$OUT"

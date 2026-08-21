#!/usr/bin/env bash
# Prove true 4K playback on the Pi: HDMI mode, matched marker, decode path, frame health.
# Run while a 4K title is playing (or immediately after handoff).
#
# Usage (on Pi or via pi-exec):
#   bash scripts/diag/playback-4k-proof.sh
#   bash scripts/diag/playback-4k-proof.sh --watch   # sample every 2s until Ctrl-C

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
IPC_SH="${MANGO_MPV_IPC_SH:-$REPO_DIR/scripts/m2-catalog/service/mpv-ipc.sh}"
DISPLAY_SH="${MANGO_DISPLAY_MODE_SH:-$REPO_DIR/scripts/lib/mango-display-mode.sh}"
MATCHED_FILE="${MANGO_PLAYBACK_DISPLAY_MATCHED_FILE:-$HOME/.cache/mango/playback-display-matched}"
ACTIVE_FILE="${MANGO_PLAYBACK_ACTIVE_FILE:-$HOME/.cache/mango/playback-active}"
WATCH=0
INTERVAL_SEC="${MANGO_PLAYBACK_4K_PROOF_INTERVAL_SEC:-2}"

for arg in "$@"; do
  case "$arg" in
    --watch|-w) WATCH=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
  esac
done

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export HOME="${HOME:?HOME must be set}"

prop() {
  local name="$1"
  local reply
  reply="$(bash "$IPC_SH" get_property "$name" 2>/dev/null || true)"
  python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print("—")
    raise SystemExit(0)
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("—")
    raise SystemExit(0)
val = data.get("data")
if val is None:
    print("—")
elif isinstance(val, float):
    print(f"{val:.3f}" if abs(val) < 1000 else f"{val:.1f}")
else:
    print(val)
' <<<"$reply" 2>/dev/null || echo "—"
}

# UHD “4K” includes flat 3840x2160 and cinema-scope masters stored as
# ~3840x1600 (2.40:1) with no letterbox bars in the file.
is_4k_dim() {
  local w="${1:-0}" h="${2:-0}"
  python3 -c "import sys; w=int(float(sys.argv[1] or 0)); h=int(float(sys.argv[2] or 0)); sys.exit(0 if (w>=3800 and h>=1500) else 1)" "$w" "$h" 2>/dev/null
}

sample_once() {
  local ts display matched active
  ts="$(date -Iseconds 2>/dev/null || date)"
  echo "=== mango 4K playback proof  $ts ==="

  if [[ -d "$REPO_DIR/.git" ]]; then
    echo "commit: $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  fi

  display="$(bash "$DISPLAY_SH" status 2>/dev/null || echo unknown)"
  echo "hdmi:    $display"
  if [[ "$display" == *"3840x2160"* || "$display" == *"4096x"* ]]; then
    echo "hdmi_4k: YES"
  else
    echo "hdmi_4k: NO  (expected 3840x2160 during true-4K play)"
  fi

  if [[ -f "$MATCHED_FILE" ]]; then
    matched="$(tr -d '\n' <"$MATCHED_FILE" 2>/dev/null || echo present)"
    echo "matched: YES ($matched)"
  else
    echo "matched: NO  (playback-display-matched missing — stay at browse 1080p)"
  fi

  if [[ -f "$ACTIVE_FILE" ]]; then
    active="$(tr -d '\n' <"$ACTIVE_FILE" 2>/dev/null || echo present)"
    echo "active:  YES ($active)"
  else
    echo "active:  NO"
  fi

  if ! pgrep -x mpv >/dev/null 2>&1; then
    echo "mpv:     not running — start a 4K title, then re-run"
    echo ""
    return 1
  fi
  echo "mpv:     running (pid $(pgrep -x mpv | head -1))"

  local width height dwidth dheight fps hwdec codec
  local dropped mistimed delayed pt dur pause
  width="$(prop width)"
  height="$(prop height)"
  dwidth="$(prop dwidth)"
  dheight="$(prop dheight)"
  fps="$(prop container-fps)"
  hwdec="$(prop hwdec-current)"
  codec="$(prop video-codec)"
  dropped="$(prop frame-drop-count)"
  mistimed="$(prop mistimed-frame-count)"
  delayed="$(prop vo-delayed-frame-count)"
  pt="$(prop playback-time)"
  dur="$(prop duration)"
  pause="$(prop pause)"

  echo "decode:  ${width}x${height}  d=${dwidth}x${dheight}  fps=${fps}"
  echo "codec:   ${codec}  hwdec=${hwdec}"
  echo "time:    ${pt} / ${dur}  pause=${pause}"
  echo "frames:  dropped=${dropped}  mistimed=${mistimed}  vo-delayed=${delayed}"

  local verdict="FAIL"
  local reasons=()
  if [[ "$display" != *"3840x2160"* && "$display" != *"4096x"* ]]; then
    reasons+=("hdmi-not-4k")
  fi
  if [[ ! -f "$MATCHED_FILE" ]]; then
    reasons+=("no-matched-marker")
  fi
  if ! is_4k_dim "$width" "$height"; then
    reasons+=("source-not-4k")
  fi
  if ! is_4k_dim "$dwidth" "$dheight"; then
    reasons+=("display-rect-not-4k")
  fi
  if [[ "$hwdec" == "—" || "$hwdec" == "no" || "$hwdec" == "null" ]]; then
    reasons+=("no-hwdec")
  fi

  if ((${#reasons[@]} == 0)); then
    verdict="PASS"
    echo "verdict: PASS — HDMI + source + display rect are 4K with hwdec"
  else
    echo "verdict: FAIL — ${reasons[*]}"
  fi

  # Soft health note (does not fail the proof alone).
  python3 -c '
import sys
try:
    d = float(sys.argv[1]) if sys.argv[1] not in ("—", "") else 0.0
except ValueError:
    d = 0.0
if d > 30:
    print(f"note:    elevated frame-drop-count={d:.0f} — watch for stutter")
elif d > 0:
    print(f"note:    frame-drop-count={d:.0f} (small drops OK on seek/start)")
' "$dropped" 2>/dev/null || true
  echo ""
  [[ "$verdict" == "PASS" ]]
}

if (( WATCH )); then
  echo "watching every ${INTERVAL_SEC}s (Ctrl-C to stop)"
  echo ""
  while true; do
    sample_once || true
    sleep "$INTERVAL_SEC"
  done
fi

sample_once
exit $?

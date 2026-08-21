#!/usr/bin/env bash
# Sample mpv presentation health during live play (run on Pi while 4K is up).
set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
IPC="$REPO_DIR/scripts/m2-catalog/service/mpv-ipc.sh"
SECS="${1:-12}"

prop() {
  bash "$IPC" get_property "$1" 2>/dev/null | python3 -c '
import json,sys
try:
  print(json.load(sys.stdin).get("data"))
except Exception:
  print("None")
' 2>/dev/null || echo "None"
}

num() {
  python3 -c 'import sys
v=sys.argv[1]
try:
  print(float(v))
except Exception:
  print(0.0)
' "$1"
}

echo "=== smoothness probe $(date -Iseconds) secs=$SECS ==="
echo "hdmi: $(bash "$REPO_DIR/scripts/lib/mango-display-mode.sh" status 2>/dev/null || echo unknown)"
echo "matched: $([[ -f ~/.cache/mango/playback-display-matched ]] && echo yes || echo no)"
echo "freezer: $(systemctl --user show mango-launcher-chromium.service -p FreezerState --value 2>/dev/null || echo ?)"
echo "xcompmgr: $(pgrep -x xcompmgr >/dev/null && echo running || echo none)"
echo "lxpanel: $(pgrep -x lxpanel >/dev/null && echo running || echo none)"
echo "pcmanfm: $(pgrep -x pcmanfm >/dev/null && echo running || echo none)"
echo "osd: $(pgrep -f 'playback-osd.py --run' >/dev/null && echo running || echo none) visible=$(tr -d '\n' < ~/.cache/mango/playback-osd.visible 2>/dev/null || echo none)"
echo "mpv_cmdline_sync: $(tr '\0' ' ' < /proc/$(pgrep -x mpv | head -1)/cmdline 2>/dev/null | grep -oE 'video-sync=[^ ]+' || echo ?)"
echo "mpv_cmdline_blend: $(tr '\0' ' ' < /proc/$(pgrep -x mpv | head -1)/cmdline 2>/dev/null | grep -oE 'blend-subtitles=[^ ]+' || echo ?)"
echo

echo "--- snapshot ---"
for p in video-sync hwdec-current current-vo container-fps display-fps estimated-display-fps \
         estimated-vf-fps frame-drop-count decoder-frame-drop-count vo-delayed-frame-count \
         mistimed-frame-count demuxer-cache-duration avsync audio-speed video-speed \
         blend-subtitles aid audio-codec-name audio-params/channel-count; do
  printf "%-28s %s\n" "$p" "$(prop "$p")"
done
echo

blend="$(prop blend-subtitles)"
aid="$(prop aid)"
t0="$(prop playback-time)"; d0="$(prop frame-drop-count)"; e0="$(prop estimated-display-fps)"
vd0="$(prop vo-delayed-frame-count)"; a0="$(prop avsync)"
sleep "$SECS"
t1="$(prop playback-time)"; d1="$(prop frame-drop-count)"; e1="$(prop estimated-display-fps)"
vd1="$(prop vo-delayed-frame-count)"; a1="$(prop avsync)"

python3 - "$t0" "$t1" "$d0" "$d1" "$e0" "$e1" "$vd0" "$vd1" "$a0" "$a1" "$SECS" "$blend" "$aid" <<'PY'
import sys
def f(x):
    try: return float(x)
    except Exception: return 0.0
t0,t1,d0,d1,e0,e1,vd0,vd1,a0,a1,wall = map(f, sys.argv[1:12])
blend, aid = sys.argv[12], sys.argv[13]
dt = max(0.001, t1 - t0)
rate = (d1 - d0) / dt
print("--- sample ---")
print(f"wall_s={wall:.1f} playback_dt={dt:.2f}s blend={blend} aid={aid}")
print(f"drops {d0:.0f} -> {d1:.0f}  delta={d1-d0:.0f}  rate={rate:.3f}/s")
print(f"edfps {e0:.3f} -> {e1:.3f}")
print(f"vo-delayed {vd0:.0f} -> {vd1:.0f}")
print(f"avsync {a0} -> {a1}")
audio_on = aid not in ("False", "false", "no", "None", "0", "")
if blend in ("True", "true", "yes", "1") and audio_on and rate > 0.2:
    print("verdict: SUSTAINED_DROPS (blend-subtitles=yes + audio — set blend-subtitles=no)")
elif rate > 0.2:
    print("verdict: SUSTAINED_DROPS")
elif (d1 - d0) > 0:
    print("verdict: LIGHT_DROPS")
else:
    print("verdict: CLEAN")
PY

echo
echo "--- clocks ---"
vcgencmd measure_temp 2>/dev/null || true
vcgencmd get_throttled 2>/dev/null || true
vcgencmd measure_clock gpu 2>/dev/null || true
vcgencmd get_mem gpu 2>/dev/null || true
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)"
ps -o pid,pcpu,pmem,rss,comm -p "$(pgrep -x mpv | head -1)" "$(pgrep -x Xorg | head -1)" 2>/dev/null || true

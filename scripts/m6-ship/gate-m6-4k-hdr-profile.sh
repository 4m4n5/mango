#!/usr/bin/env bash
# M6 couch playback profile gate — mpv-hifi ship path + display/EDID checks.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR" || exit 1

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init
gate_header "M6 mpv-hifi couch profile"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

if [[ -f "${HOME}/.config/mango/voice.env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.config/mango/voice.env"
fi

CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
PROFILE="${MANGO_CATALOG_FILTERS:-}"
REQUIRE_4K_FILM="${MANGO_REQUIRE_4K_FILM:-0}"

if [[ -n "$PROFILE" && -f "$PROFILE" ]]; then
  gate_pass "catalog filters profile exists"
else
  gate_fail "MANGO_CATALOG_FILTERS profile missing (${PROFILE:-unset})"
fi

if [[ -n "$PROFILE" && -f "$PROFILE" ]]; then
  if python3 - "$PROFILE" <<'PY'
import json
import os
import sys

path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
name = os.path.basename(path).lower()
hifi = "hifi" in name or data.get("_profile", "").lower().find("hifi") >= 0

assert data.get("max_quality") in ("4k", "2160p"), data.get("max_quality")
assert data.get("preferred_quality") in ("4k", "2160p"), data.get("preferred_quality")
assert data.get("include_uncached") is False, data.get("include_uncached")
codecs = [str(v).lower() for v in data.get("preferred_video_codecs") or []]
assert any(codec in codecs for codec in ("hevc", "x265", "h265")), codecs
steps = data.get("main_ladder") or data.get("play_ladder") or []
assert steps, steps
assert steps[0].get("max_quality") == "2160p", steps[0]
assert steps[0].get("min_quality") == "2160p", steps[0]
assert any((step or {}).get("max_quality") == "1080p" for step in steps[1:]), steps

if hifi:
    assert data.get("exclude_remux") is False, data.get("exclude_remux")
    assert steps[0].get("step") == "4k_sdr_remux_cached", steps[0]
    assert steps[0].get("exclude_hdr") is True, steps[0]
    assert steps[0].get("require_hevc") is True, steps[0]
    last_resort = data.get("last_resort_ladder") or []
    assert any((step or {}).get("step") == "1080p_uncached_fallback" for step in last_resort), last_resort
    soft_idx = next((i for i, step in enumerate(last_resort) if (step or {}).get("step") == "4k_sdr_soft_cached"), -1)
    uncached_idx = next((i for i, step in enumerate(last_resort) if (step or {}).get("step") == "1080p_uncached_fallback"), -1)
    assert uncached_idx >= 0 and soft_idx > uncached_idx, last_resort
else:
    assert data.get("exclude_remux") is True, data.get("exclude_remux")
    assert steps[0].get("step") == "4k_hevc_cached", steps[0]
PY
  then
    gate_pass "4K stream policy matches profile (${PROFILE##*/})"
  else
    gate_fail "4K stream policy invalid for ${PROFILE##*/}"
  fi
fi

[[ "${MANGO_LAUNCHER_DISPLAY_MODE:-}" == "1920x1080" ]] \
  && [[ "${MANGO_LAUNCHER_DISPLAY_RATE:-}" == "60" ]] \
  && gate_pass "launcher pinned to 1920x1080@60" \
  || gate_fail "launcher display not pinned to 1920x1080@60"

[[ "${MANGO_MPV_DISPLAY_MODE:-}" == "1920x1080" ]] \
  && [[ "${MANGO_MPV_DISPLAY_RATE:-}" == "60" ]] \
  && gate_pass "mpv unknown-source fallback is 1920x1080@60" \
  || gate_fail "mpv unknown-source fallback not 1920x1080@60"

[[ "${MANGO_MPV_DISPLAY_RATE_STRICT:-}" == "1" ]] \
  && [[ "${MANGO_MPV_DISPLAY_FALLBACK_MODE:-}" == "1920x1080" ]] \
  && [[ "${MANGO_MPV_DISPLAY_FALLBACK_RATE:-}" == "60" ]] \
  && gate_pass "mpv display fallback is 1920x1080@60" \
  || gate_fail "mpv display fallback not pinned to 1920x1080@60"

[[ "${MANGO_MPV_HWDEC:-}" == "auto-safe" ]] \
  && gate_pass "mpv hardware decode pinned to auto-safe" \
  || gate_fail "mpv hardware decode not pinned to auto-safe"

[[ "${MANGO_MPV_MATCH_REFRESH:-}" == "1" ]] \
  && gate_pass "mpv source refresh matching enabled" \
  || gate_fail "mpv source refresh matching disabled"

[[ "${MANGO_MPV_MATCH_4K_MODE:-}" == "3840x2160" ]] \
  && gate_pass "4K source output maps to 3840x2160" \
  || gate_fail "4K source output not mapped to 3840x2160"

[[ "${MANGO_MPV_VIDEO_SYNC:-}" == "display-resample" ]] \
  && gate_pass "mpv HD pacing uses display-resample" \
  || gate_fail "mpv HD pacing not display-resample (${MANGO_MPV_VIDEO_SYNC:-unset})"

[[ "${MANGO_MPV_VIDEO_SYNC_4K:-display-vdrop}" == "display-vdrop" ]] \
  && [[ "${MANGO_MPV_VIDEO_SYNC_4K_MATCHED:-audio}" == "audio" ]] \
  && grep -q 'resolve_4k_video_sync_value' scripts/m2-catalog/service/mpv-play.sh \
  && grep -q 'playback-display-matched' scripts/lib/mango-display-mode.sh \
  && gate_pass "mpv 4K pacing: audio when refresh matched, display-vdrop fallback" \
  || gate_fail "mpv 4K conditional sync not wired (4K=${MANGO_MPV_VIDEO_SYNC_4K:-unset} matched=${MANGO_MPV_VIDEO_SYNC_4K_MATCHED:-unset})"

[[ "${MANGO_MPV_INTERPOLATION:-}" == "no" ]] \
  && gate_pass "mpv interpolation disabled for native cadence" \
  || gate_fail "mpv interpolation not pinned off"

[[ "${MANGO_MPV_DISABLE_XCOMPMGR:-}" == "1" ]] \
  && gate_pass "mpv playback disables xcompmgr to prevent tearing" \
  || gate_fail "mpv playback does not disable xcompmgr"

[[ "${MANGO_MPV_STOP_LAUNCHER:-}" == "1" ]] \
  && grep -q 'mango-window.sh" hide' scripts/m2-catalog/service/mpv-play.sh \
  && gate_pass "mpv playback hides launcher surface while fullscreen" \
  || gate_fail "mpv playback does not hide launcher surface"

[[ "${MANGO_MPV_DEFER_FOREGROUND:-}" == "1" ]] \
  && gate_pass "mpv deferred foreground handoff enabled" \
  || gate_fail "mpv deferred foreground handoff disabled"

[[ "${MANGO_MPV_VOD_SWAPINTERVAL:-1}" == "1" ]] \
  && gate_pass "mpv VOD swap interval pinned for tear-free X11" \
  || gate_warn "mpv VOD swap interval not 1 (${MANGO_MPV_VOD_SWAPINTERVAL:-unset})"

if [[ -f /etc/mango/catalog-filters.json && -n "${MANGO_CATALOG_FILTERS:-}" && -f "${MANGO_CATALOG_FILTERS}" ]]; then
  if cmp -s "${MANGO_CATALOG_FILTERS}" /etc/mango/catalog-filters.json; then
    gate_pass "/etc/mango/catalog-filters.json matches active profile"
  else
    gate_warn "/etc/mango/catalog-filters.json drifted from ${MANGO_CATALOG_FILTERS} (runtime uses env profile)"
  fi
fi

if command -v xrandr >/dev/null 2>&1; then
  output="$(xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')"
  if [[ -n "${output:-}" ]]; then
    current="$(bash scripts/lib/mango-display-mode.sh status 2>/dev/null || true)"
    [[ -n "$current" ]] && echo "display: $current"

    if xrandr --query 2>/dev/null | awk -v out="$output" '
      $1 == out && $2 == "connected" { in_output=1; next }
      in_output && /^[A-Za-z0-9-]+ connected/ { exit }
      in_output && $1 == "1920x1080" {
        for (i = 2; i <= NF; i++) {
          rate=$i
          gsub(/[*+]/, "", rate)
          if (rate + 0 >= 23.9 && rate + 0 <= 24.1) found=1
        }
      }
      END { exit found ? 0 : 1 }
    '; then
      gate_pass "connected display advertises 1080p film cadence"
    else
      gate_warn "connected display does not advertise 1080p 23.98/24"
    fi

    if xrandr --query 2>/dev/null | awk -v out="$output" '
      $1 == out && $2 == "connected" { in_output=1; next }
      in_output && /^[A-Za-z0-9-]+ connected/ { exit }
      in_output && $1 == "3840x2160" {
        for (i = 2; i <= NF; i++) {
          rate=$i
          gsub(/[*+]/, "", rate)
          if (rate + 0 >= 23.9 && rate + 0 <= 24.1) found=1
        }
      }
      END { exit found ? 0 : 1 }
    '; then
      gate_pass "connected display advertises 4K film cadence"
    elif [[ "$REQUIRE_4K_FILM" == "1" ]]; then
      gate_fail "connected display does not advertise 4K 23.98/24"
    else
      gate_warn "connected display does not advertise 4K film cadence"
    fi
  else
    gate_fail "no connected xrandr output"
  fi
else
  gate_warn "xrandr unavailable"
fi

if curl -sf --max-time 5 "$CATALOG/health" >/dev/null 2>&1; then
  gate_pass "catalog /health"
else
  gate_fail "catalog /health"
fi

if state="$(curl -sf --max-time 10 "$CATALOG/reliability/state" 2>/dev/null)"; then
  python3 - "$state" <<'PY' || gate_warn "reliability state unreadable"
import json
import sys
payload = json.loads(sys.argv[1])
print("reliability:", payload.get("status"), "-", payload.get("summary"))
PY
  gate_pass "reliability state"
else
  gate_warn "reliability state unavailable"
fi

mem_avail_mb="$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
root_used_pct="$(df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}' || echo 0)"
load="$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo unknown)"
temp="$(vcgencmd measure_temp 2>/dev/null || true)"
throttle="$(vcgencmd get_throttled 2>/dev/null || true)"
echo "resources: mem_available_mb=${mem_avail_mb:-0} root_used_pct=${root_used_pct:-0} load=${load} ${temp} ${throttle}"

if [[ "${mem_avail_mb:-0}" -ge 1500 ]]; then
  gate_pass "memory headroom ${mem_avail_mb} MB"
elif [[ "${mem_avail_mb:-0}" -ge 900 ]]; then
  gate_warn "memory headroom low ${mem_avail_mb} MB"
else
  gate_fail "memory headroom critically low ${mem_avail_mb} MB"
fi

if [[ "${root_used_pct:-0}" -lt 85 ]]; then
  gate_pass "root disk usage ${root_used_pct}%"
elif [[ "${root_used_pct:-0}" -lt 95 ]]; then
  gate_warn "root disk usage high ${root_used_pct}%"
else
  gate_fail "root disk usage critical ${root_used_pct}%"
fi

gate_finish "gate-m6-4k-hdr-profile"

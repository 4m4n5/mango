#!/usr/bin/env bash
# M6.3 Stage 2 4K/HDR readiness gate. Safe on a 1080p lab monitor by default.

set -uo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR" || exit 1

# shellcheck source=../lib/gate-common.sh
source "$REPO_DIR/scripts/lib/gate-common.sh"
mango_gate_init
gate_header "M6.3 Stage 2 4K/HDR Profile"

CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
PROFILE="${MANGO_CATALOG_FILTERS:-}"
REQUIRE_TV="${MANGO_4K_REQUIRE_TV:-0}"

if [[ -n "$PROFILE" && -f "$PROFILE" ]]; then
  gate_pass "catalog filters profile exists"
else
  gate_fail "MANGO_CATALOG_FILTERS profile missing (${PROFILE:-unset})"
fi

if [[ -n "$PROFILE" && -f "$PROFILE" ]]; then
  if python3 - "$PROFILE" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data.get("max_quality") == "2160p", data.get("max_quality")
assert data.get("preferred_quality") == "2160p", data.get("preferred_quality")
assert data.get("exclude_remux") is True, data.get("exclude_remux")
assert data.get("include_uncached") is False, data.get("include_uncached")
tags = [str(v).lower() for v in data.get("preferred_hdr_tags") or []]
assert any(tag in tags for tag in ("hdr10+", "hdr10", "hdr")), tags
steps = data.get("play_ladder") or []
assert any((step or {}).get("max_quality") == "2160p" for step in steps), steps
PY
  then
    gate_pass "4K/HDR stream policy"
  else
    gate_fail "4K/HDR stream policy invalid"
  fi
fi

[[ "${MANGO_LAUNCHER_DISPLAY_MODE:-}" == "1920x1080" ]] \
  && [[ "${MANGO_LAUNCHER_DISPLAY_RATE:-}" == "60" ]] \
  && gate_pass "launcher pinned to 1920x1080@60" \
  || gate_fail "launcher display not pinned to 1920x1080@60"

[[ "${MANGO_MPV_DISPLAY_MODE:-}" == "3840x2160" ]] \
  && [[ "${MANGO_MPV_DISPLAY_RATE:-}" == "60" ]] \
  && gate_pass "mpv playback targets 3840x2160@60" \
  || gate_fail "mpv playback mode not 3840x2160@60"

if command -v xrandr >/dev/null 2>&1; then
  output="$(xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')"
  if [[ -n "${output:-}" ]]; then
    current="$(bash scripts/lib/mango-display-mode.sh status 2>/dev/null || true)"
    [[ -n "$current" ]] && echo "display: $current"
    if xrandr --query 2>/dev/null | awk -v out="$output" '
      $1 == out && $2 == "connected" { in_output=1; next }
      in_output && /^[A-Za-z0-9-]+ connected/ { exit }
      in_output && $1 == "3840x2160" {
        for (i = 2; i <= NF; i++) {
          rate=$i
          gsub(/[*+]/, "", rate)
          if (int(rate + 0.5) == 60) found=1
        }
      }
      END { exit found ? 0 : 1 }
    '; then
      gate_pass "connected display advertises 3840x2160@60"
    elif [[ "$REQUIRE_TV" == "1" ]]; then
      gate_fail "connected display does not advertise 3840x2160@60"
    else
      gate_warn "connected display does not advertise 3840x2160@60 on this monitor"
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

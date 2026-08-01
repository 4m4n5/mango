#!/usr/bin/env bash
# Print a concise Pi resource snapshot for couch readiness decisions.

set -euo pipefail

decode_throttled() {
  local raw="${1#throttled=}"
  if [[ ! "$raw" =~ ^0[xX][0-9a-fA-F]+$ ]]; then
    echo "throttle_raw=$raw throttle_verdict=WARN throttle_reason=unparseable"
    return 0
  fi

  local value=$((raw))
  local -a active=()
  local -a history=()
  (( value & 0x1 )) && active+=(undervoltage)
  (( value & 0x2 )) && active+=(frequency-capped)
  (( value & 0x4 )) && active+=(throttled)
  (( value & 0x8 )) && active+=(soft-temperature-limit)
  (( value & 0x10000 )) && history+=(undervoltage)
  (( value & 0x20000 )) && history+=(frequency-capped)
  (( value & 0x40000 )) && history+=(throttled)
  (( value & 0x80000 )) && history+=(soft-temperature-limit)

  local verdict=OK
  # Only current undervoltage/throttling are snapshot failures. Frequency cap,
  # soft-temperature and all sticky history bits remain diagnostic warnings.
  if (( value & 0x5 )); then
    verdict=FAIL
  elif (( value & 0xA )) || ((${#history[@]} > 0)); then
    verdict=WARN
  fi
  local active_text=none
  local history_text=none
  ((${#active[@]} > 0)) && active_text="$(IFS=,; echo "${active[*]}")"
  ((${#history[@]} > 0)) && history_text="$(IFS=,; echo "${history[*]}")"
  echo "throttle_raw=$raw throttle_verdict=$verdict throttle_active=$active_text throttle_history=$history_text"
  [[ "$verdict" != "FAIL" ]]
}

if [[ "${1:-}" == "--decode-throttled" ]]; then
  decode_throttled "${2:-invalid}"
  exit $?
fi

SNAPSHOT_RC=0

echo "timestamp=$(date -Iseconds)"
echo "host=$(hostname)"
echo "uptime=$(uptime -p 2>/dev/null || true)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo unknown)"

if command -v free >/dev/null 2>&1; then
  free -m | awk '
    /^Mem:/ { printf("mem_total_mb=%s mem_used_mb=%s mem_available_mb=%s\n", $2, $3, $7) }
    /^Swap:/ { printf("swap_total_mb=%s swap_used_mb=%s\n", $2, $3) }
  '
else
  awk '
    /^MemTotal:/ { total=int($2/1024) }
    /^MemAvailable:/ { avail=int($2/1024) }
    END { printf("mem_total_mb=%s mem_available_mb=%s\n", total, avail) }
  ' /proc/meminfo
fi

df_targets=(/ "$HOME")
[[ -d /etc/mango ]] && df_targets+=(/etc/mango)
df -h "${df_targets[@]}" 2>/dev/null | awk 'NR==1 || !seen[$6]++ {print}'

if command -v vcgencmd >/dev/null 2>&1; then
  vcgencmd measure_temp 2>/dev/null || true
  THROTTLED_RAW="$(vcgencmd get_throttled 2>/dev/null || true)"
  if [[ -n "$THROTTLED_RAW" ]]; then
    decode_throttled "$THROTTLED_RAW" || SNAPSHOT_RC=1
  else
    echo "throttle_raw=unavailable throttle_verdict=WARN throttle_reason=vcgencmd-failed"
  fi
fi

echo "top_rss:"
ps -eo pid,comm,rss,%cpu,%mem,args --sort=-rss | head -12 || true

exit "$SNAPSHOT_RC"

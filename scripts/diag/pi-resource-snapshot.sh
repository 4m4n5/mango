#!/usr/bin/env bash
# Print a concise Pi resource snapshot for couch readiness decisions.

set -euo pipefail

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
  vcgencmd get_throttled 2>/dev/null || true
fi

echo "top_rss:"
ps -eo pid,comm,rss,%cpu,%mem,args --sort=-rss | head -12

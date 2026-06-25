#!/usr/bin/env bash
# Couch latency + resource snapshot (run on Pi or via scripts/pi-exec.sh).
set -euo pipefail

CATALOG_URL="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
LAUNCHER_URL="${MANGO_LAUNCHER_URL:-http://127.0.0.1:3000}"
RUNS="${MANGO_PERF_RUNS:-3}"

bench() {
  local label="$1"
  local url="$2"
  local total=0
  local ms
  printf "%-22s" "$label"
  for ((i = 1; i <= RUNS; i++)); do
    if ms=$(curl -sf -o /dev/null -w "%{time_total}" "$url" 2>/dev/null); then
      :
    else
      ms="9.999"
    fi
    ms=$(python3 -c "print(int(float('${ms}') * 1000))")
    total=$((total + ms))
    printf " %4dms" "$ms"
  done
  printf " | avg=%dms\n" "$((total / RUNS))"
}

echo "=== mango perf snapshot $(date -Iseconds) ==="
if [[ -d "${HOME}/mango/.git" ]]; then
  echo "commit: $(git -C "${HOME}/mango" rev-parse --short HEAD 2>/dev/null || echo unknown)"
fi
echo ""

echo "--- system ---"
free -h | head -2
echo "load: $(cat /proc/loadavg)"
vcgencmd measure_temp 2>/dev/null || true
if [[ -x "${HOME}/mango/scripts/lib/mango-display-mode.sh" ]]; then
  printf "display: "
  bash "${HOME}/mango/scripts/lib/mango-display-mode.sh" status 2>/dev/null || true
fi
echo ""

echo "--- top RSS ---"
ps -eo pid,rss,comm --sort=-rss | head -15 | awk 'NR==1 || $2>0 {printf "%6s %7.1fMB %s\n", $1, $2/1024, $3}'
echo ""

echo "--- launcher browser ---"
pgrep -af 'chromium.*mango-launcher|firefox.*127.0.0.1:3000' 2>/dev/null || echo "launcher browser not found"
echo ""

echo "--- catalog health ---"
curl -sf "${CATALOG_URL}/health" | python3 -m json.tool 2>/dev/null || echo "catalog down"
echo ""

echo "--- endpoint latency (${RUNS} runs) ---"
bench "health" "${CATALOG_URL}/health"
bench "rails" "${CATALOG_URL}/rails"
bench "tab-movies" "${CATALOG_URL}/rails/items?tab=movies"
bench "tab-series" "${CATALOG_URL}/rails/items?tab=series"
bench "tab-live" "${CATALOG_URL}/rails/items?tab=live"
bench "meta-movie" "${CATALOG_URL}/meta/movie/tt0111161"
bench "stream-movie" "${CATALOG_URL}/stream/movie/tt0111161"
bench "launcher-health" "${LAUNCHER_URL}/api/health"
bench "orchestrator" "http://127.0.0.1:8765/health"
echo ""

echo "--- playability db ---"
python3 <<'PY'
import os, sqlite3
path = os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db")
try:
    db = sqlite3.connect(path)
    pool = db.execute("SELECT COUNT(*) FROM rail_pool").fetchone()[0]
    disp = db.execute(
        "SELECT COUNT(*) FROM rail_pool WHERE length(trim(coalesce(title,'')))>0"
        " AND length(trim(coalesce(poster_url,'')))>0"
    ).fetchone()[0]
    verified = db.execute("SELECT COUNT(*) FROM titles WHERE status='verified'").fetchone()[0]
    pending = db.execute("SELECT COUNT(*) FROM titles WHERE status='pending'").fetchone()[0]
    print(f"pool={pool} display_snapshots={disp} verified={verified} pending={pending}")
except Exception as e:
    print(f"db: {e}")
PY

echo ""
echo "--- locks / maintenance ---"
ls -la "${HOME}/.cache/mango/"*.lock 2>/dev/null || echo "no locks"
pgrep -af 'playability|fill-pool|overnight' 2>/dev/null || echo "no maintenance procs"

echo ""
echo "--- docker ---"
docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null | head -6 || echo "docker n/a"

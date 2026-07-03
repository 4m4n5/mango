#!/usr/bin/env bash
# A/B stream-yield probe for India regional titles (run on Pi with catalog up).
#
# Measures how many titles from a probe list resolve to >=1 mango-playable
# (cached, filtered) stream via GET /stream/<type>/<id>. Because /stream runs the
# full mango stream plane (AIOStreams -> TorBox + mango filters), this reflects
# exactly what a nightly grow would verify. Use it before AND after enabling
# MediaFusion in AIOStreams to get the true regional-supply delta.
#
# Probe file format (one per line, blank lines and # comments ignored):
#   tt1234567            # defaults to type=movie
#   tt7654321 series
#   tt2222222 movie      # language/notes after a second # are fine
#
# Usage (on Pi):
#   bash scripts/diag/india-regional-yield.sh /tmp/india-probe.txt before
#   # ... enable MediaFusion in AIOStreams, then:
#   bash scripts/diag/india-regional-yield.sh /tmp/india-probe.txt after
#   # delta vs a prior run:
#   MANGO_INDIA_PROBE_BASELINE=/tmp/india-yield-before.tsv \
#     bash scripts/diag/india-regional-yield.sh /tmp/india-probe.txt after
#
# Success bar (from the MediaFusion trial plan):
#   >=60% of the probe list returns >=1 stream after MediaFusion, AND
#   >=+30 percentage-point improvement vs the "before" run.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
cd "$REPO_DIR"

PROBE_FILE="${1:-/tmp/india-probe.txt}"
LABEL="${2:-run}"
CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
TIMEOUT="${MANGO_INDIA_PROBE_TIMEOUT:-120}"
OUT="${MANGO_INDIA_PROBE_OUT:-/tmp/india-yield-${LABEL}.tsv}"
BASELINE="${MANGO_INDIA_PROBE_BASELINE:-}"

[[ -f "$PROBE_FILE" ]] || { echo "probe file not found: $PROBE_FILE" >&2; exit 2; }
curl -sf --max-time 5 "$CATALOG/health" >/dev/null || { echo "catalog down at $CATALOG" >&2; exit 1; }

printf 'id\ttype\tkept\tresolve_ms\ttop_source\tcache\n' >"$OUT"

total=0
hits=0
echo "== india regional yield: label=$LABEL file=$PROBE_FILE =="
printf '%-14s %-7s %5s  %-9s %s\n' "id" "type" "kept" "resolve" "top_source/cache"

while IFS= read -r raw || [[ -n "$raw" ]]; do
  line="${raw%%#*}"
  line="$(echo "$line" | xargs || true)"
  [[ -z "$line" ]] && continue
  id="$(echo "$line" | awk '{print $1}')"
  type="$(echo "$line" | awk '{print ($2==""?"movie":$2)}')"
  [[ -z "$id" ]] && continue
  total=$((total + 1))

  json="$(curl -sf --max-time "$TIMEOUT" "$CATALOG/stream/${type}/${id}" 2>/dev/null || echo '')"
  read -r kept resolve_ms top_source cache < <(
    echo "$json" | python3 - <<'PY' 2>/dev/null || echo "0 - - -"
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("0 - - -"); raise SystemExit
streams = d.get("streams") or []
filt = d.get("filters") or {}
kept = filt.get("kept", len(streams))
top = streams[0] if streams else {}
print(kept, d.get("resolve_ms", "-"), (top.get("source") or "-"), (top.get("cache_status") or "-"))
PY
  )
  kept="${kept:-0}"
  [[ "$kept" =~ ^[0-9]+$ ]] || kept=0
  if [[ "$kept" -ge 1 ]]; then hits=$((hits + 1)); fi
  printf '%-14s %-7s %5s  %-9s %s\n' "$id" "$type" "$kept" "${resolve_ms}" "${top_source}/${cache}"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$type" "$kept" "$resolve_ms" "$top_source" "$cache" >>"$OUT"
done <"$PROBE_FILE"

rate=0
if [[ "$total" -gt 0 ]]; then rate=$(python3 -c "print(round(100*$hits/$total,1))"); fi
echo
echo "== summary ($LABEL): $hits/$total returned >=1 stream = ${rate}% =="
echo "   report: $OUT"

if [[ -n "$BASELINE" && -f "$BASELINE" ]]; then
  base_rate=$(python3 - "$BASELINE" <<'PY'
import sys
tot=hit=0
with open(sys.argv[1]) as f:
    next(f, None)
    for ln in f:
        p = ln.rstrip("\n").split("\t")
        if len(p) < 3: continue
        tot += 1
        try:
            if int(p[2]) >= 1: hit += 1
        except ValueError:
            pass
print(round(100*hit/tot,1) if tot else 0.0)
PY
  )
  delta=$(python3 -c "print(round($rate-$base_rate,1))")
  echo "== delta vs baseline ($BASELINE): ${base_rate}% -> ${rate}% = ${delta}pp =="
  echo "   GO bar: rate >= 60% AND delta >= +30pp"
fi

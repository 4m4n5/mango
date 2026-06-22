#!/usr/bin/env bash
# Diag — Cinemeta episode meta + per-episode stream availability for a series.
#
# Usage:
#   bash scripts/diag/series-episodes.sh [bare-imdb-id]
#   bash scripts/diag/series-episodes.sh tt12004706
#   bash scripts/diag/series-episodes.sh --sample   # Panchayat, Breaking Bad, Chernobyl
#
# Requires catalog-service on :3020 (MANGO_CATALOG=1).

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CATALOG_URL="${MANGO_CATALOG_URL:-http://127.0.0.1:3020}"
SAMPLE_IDS=(tt12004706 tt0903747 tt7366338)
PROBE_EPISODES="${MANGO_SERIES_DIAG_PROBE:-3}"

usage() {
  sed -n '2,8p' "$0" >&2
  exit 2
}

diag_series() {
  local bare_id="$1"
  local meta_json
  local meta_file="/tmp/mango-series-meta-${bare_id}.json"

  echo "=== series ${bare_id} ==="

  if ! curl -sf --max-time 45 "${CATALOG_URL}/meta/series/${bare_id}" >"$meta_file"; then
    echo "FAIL: GET /meta/series/${bare_id}" >&2
    return 1
  fi
  meta_json="$(cat "$meta_file")"

  python3 - "$meta_file" "$bare_id" "$CATALOG_URL" "$PROBE_EPISODES" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request

meta_path, bare_id, catalog_url, probe_limit = sys.argv[1:5]
probe_limit = max(1, int(probe_limit))

with open(meta_path, encoding="utf-8") as handle:
    meta = json.load(handle)

videos = meta.get("videos") or []
name = meta.get("name") or meta.get("title") or meta.get("id")
print(f"name: {name}")
print(f"videos: {len(videos)}")

if not videos:
    print("WARN: no videos[] — episode picker blocked until meta addon returns episodes")
    raise SystemExit(0)

seasons = sorted({int(v.get("season") or 0) for v in videos})
print(f"seasons: {len(seasons)} {seasons}")

first = videos[0]
last = videos[-1]
print(
    "range:",
    f"S{first.get('season')}E{first.get('episode')}",
    "→",
    f"S{last.get('season')}E{last.get('episode')}",
)

# Sample episodes: first, mid, last, plus spread across list.
indices = sorted({
    0,
    len(videos) // 4,
    len(videos) // 2,
    (3 * len(videos)) // 4,
    len(videos) - 1,
})[:probe_limit]
picked = []
seen = set()
for index in indices:
    video = videos[index]
    episode_id = str(video.get("id") or "").strip()
    if not episode_id or episode_id in seen:
        continue
    seen.add(episode_id)
    picked.append(video)

def stream_count(episode_id: str) -> tuple[int | None, int, int | None]:
    url = f"{catalog_url}/stream/series/{episode_id}"
    started = time.time()
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
            ms = int((time.time() - started) * 1000)
            return len(payload.get("streams") or []), ms, response.status
    except urllib.error.HTTPError as error:
        ms = int((time.time() - started) * 1000)
        return None, ms, error.code

# Bare id resolves to S1E1 today.
count, ms, status = stream_count(bare_id)
if count is None:
    print(f"stream bare ({bare_id}): http={status} {ms}ms")
else:
    print(f"stream bare ({bare_id} → S1E1): {count} streams {ms}ms")

print("episode probes:")
for video in picked:
    episode_id = str(video.get("id") or "")
    season = video.get("season")
    episode = video.get("episode")
    title = (video.get("title") or video.get("name") or "").strip()
    count, ms, status = stream_count(episode_id)
    label = f"S{season}E{episode}"
    if title:
        label = f"{label} {title[:36]}"
    if count is None:
        print(f"  {episode_id}: {label} — http={status} {ms}ms")
    else:
        print(f"  {episode_id}: {label} — {count} streams {ms}ms")
PY
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

if [[ "${1:-}" == "--sample" ]]; then
  for id in "${SAMPLE_IDS[@]}"; do
    diag_series "$id" || true
    echo
  done
  exit 0
fi

bare_id="${1:-tt12004706}"
diag_series "$bare_id"

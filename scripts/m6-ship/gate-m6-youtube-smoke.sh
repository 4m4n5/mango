#!/usr/bin/env bash
# M6.2 native YouTube smoke gate. Safe by default: state/rails always run,
# API search/detail run only when an API key is configured, and playback runs
# only with MANGO_YOUTUBE_PLAY=1.

set -euo pipefail

CATALOG="${MANGO_CATALOG_URL:-http://127.0.0.1:${MANGO_CATALOG_PORT:-3020}}"
QUERY="${MANGO_YOUTUBE_GATE_QUERY:-lofi live}"

curl_json() {
  curl -sf --max-time "${2:-15}" "$CATALOG$1"
}

post_json() {
  local path="$1"
  local body="$2"
  curl -sf --max-time "${3:-20}" \
    -H 'content-type: application/json' \
    -d "$body" \
    "$CATALOG$path"
}

curl -sf --max-time 5 "$CATALOG/health" >/dev/null

state_json="$(curl_json "/youtube/state" 10)"
python3 - "$state_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
assert payload.get("enabled") is True
assert isinstance(payload.get("cache"), dict)
PY

yt_dlp_command="$(
  python3 - "$state_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
print(((payload.get("configured") or {}).get("yt_dlp_command")) or "")
PY
)"
if [[ -n "$yt_dlp_command" ]]; then
  if [[ "$yt_dlp_command" == */* && "$yt_dlp_command" != /* ]]; then
    yt_dlp_command="./$yt_dlp_command"
  fi
  timeout 15 "$yt_dlp_command" --version >/dev/null
fi

rails_json="$(curl_json "/youtube/rails" 20)"
python3 - "$rails_json" "$state_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
state = json.loads(sys.argv[2])
assert payload.get("ok") is True
rails = payload.get("rails")
assert isinstance(rails, list)
mode = ((state.get("recommendations_v2") or {}).get("mode")) or "off"
if mode == "serve":
    v2 = state.get("recommendations_v2")
    assert isinstance(v2, dict), "v2 diagnostics are missing"
    status = v2.get("status")
    assert status in {"setup", "empty", "ready", "stale"}, status
    setup_required = v2.get("setup_required")
    assert isinstance(setup_required, bool), "v2 setup_required must be boolean"
    assert payload.get("setup_required") is setup_required, (
        payload.get("setup_required"), setup_required
    )
    assert payload.get("recommendations_status") == status, (
        payload.get("recommendations_status"), status
    )

    candidate_count = v2.get("candidate_count")
    assert type(candidate_count) is int and candidate_count >= 0, candidate_count
    reserve_depths = v2.get("reserve_depths")
    reserve_ids = {
        "for_you", "beyond", "more_like", "new_from_subscriptions", "live_now",
    }
    assert isinstance(reserve_depths, dict), "v2 reserve depths are missing"
    assert set(reserve_depths) == reserve_ids, reserve_depths
    assert all(type(count) is int and count >= 0 for count in reserve_depths.values()), reserve_depths
    assert sum(reserve_depths.values()) == candidate_count, (
        reserve_depths, candidate_count
    )

    provenance = v2.get("provenance")
    assert isinstance(provenance, dict), "v2 provenance diagnostics are missing"
    for key in ("total", "active", "expired"):
        assert type(provenance.get(key)) is int and provenance[key] >= 0, provenance
    assert provenance["total"] == provenance["active"] + provenance["expired"], provenance
    by_provenance = provenance.get("by_provenance")
    allowed_provenance = {
        "subscription_upload", "subscription_live", "history_channel", "history_topic",
    }
    assert isinstance(by_provenance, dict), "v2 provenance counts are missing"
    assert set(by_provenance) == allowed_provenance, by_provenance
    assert all(type(count) is int and count >= 0 for count in by_provenance.values()), by_provenance
    assert sum(by_provenance.values()) == provenance["active"], provenance

    if status in {"ready", "stale"}:
        generation = v2.get("generation")
        assert type(generation) is int and generation > 0, generation
        assert setup_required is False
        assert candidate_count > 0
    else:
        assert setup_required is True

    allowed_order = [
        "for_you", "beyond", "more_like", "history", "saved",
        "new_from_subscriptions", "live_now",
    ]
    rail_ids = [(rail or {}).get("rail_id") for rail in rails]
    assert len(rail_ids) == len(set(rail_ids)), "v2 YouTube rails contain duplicate IDs"
    assert all(rail_id in allowed_order for rail_id in rail_ids), rail_ids
    assert rail_ids == sorted(rail_ids, key=allowed_order.index), rail_ids
    if status == "ready":
        assert {"for_you", "beyond", "more_like"}.issubset(rail_ids), rail_ids
    visible_ids = []
    for rail in rails:
        items = (rail or {}).get("items")
        assert isinstance(items, list)
        if rail.get("rail_id") == "live_now":
            assert 1 <= len(items) <= 4
            assert all((item or {}).get("live_status") == "live" for item in items)
        else:
            assert len(items) == 4
        for item in items:
            assert isinstance(item, dict)
            assert item.get("kind") == "video", item
            item_id = item.get("id")
            assert isinstance(item_id, str) and item_id.strip(), item
            visible_ids.append(item_id)
    assert len(visible_ids) == len(set(visible_ids)), "v2 YouTube cards repeat across rails"
else:
    assert any((rail or {}).get("rail_id") in {"fresh_finds", "popular"} for rail in rails)
PY

api_key="$(
  python3 - "$state_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
print("1" if ((payload.get("configured") or {}).get("api_key")) else "0")
PY
)"

if [[ "$api_key" != "1" ]]; then
  echo "M6.2 YouTube smoke gate ok (API-key search skipped)"
  exit 0
fi

search_json="$(curl_json "/youtube/search?q=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$QUERY")&limit=5" 30)"
video_id="$(
  python3 - "$search_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
groups = payload.get("groups") or {}
videos = groups.get("videos") or []
assert payload.get("ok") is True
assert videos, "youtube search returned no videos"
print(videos[0]["id"])
PY
)"

detail_json="$(curl_json "/youtube/detail?kind=video&id=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$video_id")" 30)"
python3 - "$detail_json" "$video_id" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
assert payload.get("ok") is True
assert (payload.get("item") or {}).get("id") == sys.argv[2]
PY

if [[ "${MANGO_YOUTUBE_PLAY:-0}" == "1" ]]; then
  out="$(mktemp)"
  trap 'rm -f "$out"; bash scripts/m2-catalog/service/mpv-stop.sh >/dev/null 2>&1 || true' EXIT
  post_json "/youtube/play" "{\"id\":\"$video_id\"}" 120 >"$out"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True
assert int(payload.get("ttff_ms") or 0) > 0
PY
fi

echo "M6.2 YouTube smoke gate ok"

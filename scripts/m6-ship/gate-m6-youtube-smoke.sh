#!/usr/bin/env bash
# M6.2 native YouTube smoke gate. Safe by default: state/rails always run,
# API search/detail run only when an API key is configured, and playback runs
# only with MANGO_YOUTUBE_PLAY=1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
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
configured = payload.get("configured")
assert isinstance(configured, dict)
descriptor = configured.get("yt_dlp_command")
kind = configured.get("yt_dlp_command_kind")
expected = {
    "yt_dlp": "yt-dlp",
    "mango_wrapper": "mango_wrapper",
    "custom": "",
    "missing": "",
}
assert kind in expected, kind
assert descriptor == expected[kind], (kind, descriptor)
PY

yt_dlp_kind="$(
  python3 - "$state_json" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
print(((payload.get("configured") or {}).get("yt_dlp_command_kind")) or "")
PY
)"
case "$yt_dlp_kind" in
  yt_dlp)
    timeout 15 yt-dlp --version >/dev/null
    ;;
  mango_wrapper)
    timeout 15 "$REPO_ROOT/scripts/m6-ship/youtube-yt-dlp.sh" --version >/dev/null
    deno_bin="${MANGO_DENO:-$HOME/.local/share/mango/deno/bin/deno}"
    if [[ -x "$deno_bin" ]]; then
      timeout 10 "$deno_bin" --version >/dev/null
    elif command -v deno >/dev/null 2>&1; then
      timeout 10 deno --version >/dev/null
    else
      echo "FAIL: YouTube JS runtime missing (Deno >=2.3). Run scripts/m6-ship/ensure-youtube-yt-dlp.sh" >&2
      exit 1
    fi
    ;;
  missing)
    ;;
  custom)
    echo "FAIL: custom yt-dlp commands are not executable from public diagnostics" >&2
    exit 1
    ;;
esac

rails_json="$(curl_json "/youtube/rails" 20)"
python3 - "$rails_json" "$state_json" <<'PY'
import json
import math
import sys
payload = json.loads(sys.argv[1])
state = json.loads(sys.argv[2])
assert payload.get("ok") is True
rails = payload.get("rails")
assert isinstance(rails, list)
mode = ((state.get("recommendations_v2") or {}).get("mode")) or "off"
assert mode in {"off", "shadow", "serve"}, mode


def is_number(value):
    return type(value) in {int, float} and math.isfinite(value)


if mode == "serve":
    v2 = state.get("recommendations_v2")
    assert isinstance(v2, dict), "v2 diagnostics are missing"
    assert v2.get("model_version") == "youtube-household-v3.0", v2.get("model_version")
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

    source_stale = v2.get("source_stale")
    assert isinstance(source_stale, dict), "v2 source-stale diagnostics are missing"
    assert set(source_stale) == {
        "stale", "reason", "error_category", "at",
        "authoritative_subscription_count",
    }, source_stale
    assert isinstance(source_stale.get("stale"), bool), source_stale
    allowed_stale_reasons = {
        "not_connected", "oauth_disconnected", "oauth_subscription_refresh_failed",
        "oauth_unavailable", "subscription_acquisition_partial",
        "subscription_snapshot_pending_publish", "discovery_acquisition_failed",
        "live_acquisition_failed", "publication_failed",
    }
    stale_reason = source_stale.get("reason")
    assert stale_reason is None or stale_reason in allowed_stale_reasons, source_stale
    allowed_error_categories = {
        "auth", "deadline", "network", "not_found", "partial", "provider",
        "publication", "quota", "validation", "unknown",
    }
    stale_error = source_stale.get("error_category")
    assert stale_error is None or stale_error in allowed_error_categories, source_stale
    stale_at = source_stale.get("at")
    assert stale_at is None or (type(stale_at) is int and stale_at >= 0), source_stale
    assert type(source_stale.get("authoritative_subscription_count")) is int \
        and source_stale["authoritative_subscription_count"] >= 0, source_stale
    if source_stale["stale"]:
        assert stale_reason is not None, source_stale
    else:
        assert stale_reason in {None, "not_connected"}, source_stale
    if status == "stale":
        assert source_stale["stale"] is True and type(v2.get("generation")) is int, source_stale
    if source_stale["stale"] and type(v2.get("generation")) is int and v2.get("candidate_count", 0) > 0:
        assert status == "stale", (status, source_stale)
    if not source_stale["stale"]:
        assert status != "stale", (status, source_stale)
    assert payload.get("stale_reason") == (stale_reason if source_stale["stale"] else None), (
        payload.get("stale_reason"), source_stale,
    )

    candidate_count = v2.get("candidate_count")
    assert type(candidate_count) is int and candidate_count >= 0, candidate_count
    reserve_depths = v2.get("reserve_depths")
    reserve_ids = {
        "for_you", "beyond", "more_like", "new_from_subscriptions",
        "frequently_watched", "live_now",
    }
    assert isinstance(reserve_depths, dict), "v2 reserve depths are missing"
    assert set(reserve_depths) == reserve_ids, reserve_depths
    assert all(type(count) is int and count >= 0 for count in reserve_depths.values()), reserve_depths
    assert sum(reserve_depths.values()) == candidate_count, (
        reserve_depths, candidate_count
    )

    caps = v2.get("caps")
    assert isinstance(caps, dict), "v2 caps are missing"
    assert caps.get("reserve_per_rail") == 512, caps
    assert caps.get("more_like_target") == 512, caps
    assert all(depth <= caps["reserve_per_rail"] for depth in reserve_depths.values()), reserve_depths
    quality_policy = v2.get("quality_policy")
    assert isinstance(quality_policy, dict), "v2 quality policy is missing"
    assert quality_policy.get("tiers") == {
        "A_min": 0.65, "B_min": 0.38, "C_min": 0.20,
    }, quality_policy
    assert quality_policy.get("c_candidates_per_rail") == 64, quality_policy

    sampling = v2.get("sampling")
    assert sampling == {
        "policy": "independent_weighted_v1",
        "independent_epoch_draws": True,
        "without_replacement_scope": "visible_slate",
        "impression_aware": False,
        "recent_slate_state": False,
    }, sampling

    pool_quality = v2.get("pool_quality")
    assert isinstance(pool_quality, dict), "v2 weighted pool diagnostics are missing"
    assert set(pool_quality) == reserve_ids, pool_quality
    metric_keys = {
        "quality_tiers", "expected_selection_share", "effective_pool_size",
        "expected_adjacent_overlap", "top_quartile_sampling_share",
        "bottom_quartile_sampling_share", "minimum_sampling_weight",
        "creator_count", "seed_count",
    }
    for rail_id, depth in reserve_depths.items():
        metrics = pool_quality.get(rail_id)
        assert isinstance(metrics, dict) and set(metrics) == metric_keys, metrics
        tiers = metrics.get("quality_tiers")
        assert isinstance(tiers, dict) and set(tiers) == {"A", "B", "C", "rejected"}, tiers
        assert all(type(count) is int and count >= 0 for count in tiers.values()), tiers
        assert tiers["rejected"] == 0, tiers
        assert tiers["A"] + tiers["B"] + tiers["C"] == depth, (rail_id, tiers, depth)
        assert tiers["C"] <= quality_policy["c_candidates_per_rail"], tiers

        shares = metrics.get("expected_selection_share")
        assert isinstance(shares, dict) and set(shares) == {"A", "B", "C"}, shares
        assert all(is_number(share) and 0 <= share <= 1 for share in shares.values()), shares
        assert abs(sum(shares.values()) - (1 if depth else 0)) <= 0.001, shares
        effective_depth = metrics.get("effective_pool_size")
        overlap = metrics.get("expected_adjacent_overlap")
        assert is_number(effective_depth) and 0 <= effective_depth <= depth, metrics
        assert is_number(overlap) and overlap >= 0, metrics
        assert is_number(metrics.get("top_quartile_sampling_share")) \
            and 0 <= metrics["top_quartile_sampling_share"] <= 1, metrics
        assert is_number(metrics.get("bottom_quartile_sampling_share")) \
            and 0 <= metrics["bottom_quartile_sampling_share"] <= 1, metrics
        assert is_number(metrics.get("minimum_sampling_weight")) \
            and 0 <= metrics["minimum_sampling_weight"] <= 1.25, metrics
        for key in ("creator_count", "seed_count"):
            assert type(metrics.get(key)) is int and 0 <= metrics[key] <= depth, metrics
        if depth:
            assert effective_depth > 0 and metrics["minimum_sampling_weight"] > 0, metrics
            assert abs(overlap - round(16 / effective_depth, 4)) <= 0.0001, metrics
        else:
            assert effective_depth == overlap == 0, metrics

    history_acquisition = v2.get("history_acquisition")
    if history_acquisition is not None:
        assert isinstance(history_acquisition, dict), history_acquisition
        skipped = history_acquisition.get("skipped")
        stop_reason = history_acquisition.get("stop_reason")
        if skipped is not None:
            assert skipped in {
                "api_key_not_configured", "no_history_or_subscription_seed", "not_nightly",
            }, history_acquisition
            assert stop_reason is None, history_acquisition
        elif stop_reason is None:
            assert status in {"setup", "empty"}, history_acquisition
        else:
            assert stop_reason in {
                "target_reached", "wall_limit", "search_budget", "low_yield", "source_exhausted",
            }, history_acquisition

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
        "for_you", "new_from_subscriptions", "frequently_watched", "more_like", "beyond",
        "history", "saved", "live_now",
    ]
    rail_ids = [(rail or {}).get("rail_id") for rail in rails]
    assert len(rail_ids) == len(set(rail_ids)), "v2 YouTube rails contain duplicate IDs"
    assert all(rail_id in allowed_order for rail_id in rail_ids), rail_ids
    assert rail_ids == sorted(rail_ids, key=allowed_order.index), rail_ids
    normal_recommendation_ids = {
        "for_you", "beyond", "more_like", "new_from_subscriptions", "frequently_watched",
    }
    for rail_id in normal_recommendation_ids:
        if reserve_depths[rail_id] < 4:
            assert rail_id not in rail_ids, (rail_id, reserve_depths, rail_ids)
    more_like = v2.get("more_like_status") or {}
    more_like_state = more_like.get("status")
    assert more_like_state in {
        "thematic", "hybrid", "exact_channel", "not_applicable",
    }, more_like
    if more_like_state == "not_applicable":
        assert "more_like" not in rail_ids, more_like
    if "more_like" in rail_ids:
        assert more_like_state in {"thematic", "hybrid", "exact_channel"}, more_like
    visible_ids = []
    for rail in rails:
        items = (rail or {}).get("items")
        assert isinstance(items, list)
        rail_stale = rail.get("stale")
        assert isinstance(rail_stale, bool), rail
        if rail.get("rail_id") in {"history", "saved"}:
            assert rail_stale is False, rail
        elif status == "stale":
            assert rail_stale is True, rail
        if rail.get("rail_id") == "live_now":
            assert 1 <= len(items) <= 4
            assert reserve_depths["live_now"] >= len(items), reserve_depths
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
    assert payload.get("recommendations_status") == "setup", payload.get("recommendations_status")
    assert payload.get("setup_required") is False, payload.get("setup_required")
    rail_ids = [(rail or {}).get("rail_id") for rail in rails]
    assert len(rail_ids) == len(set(rail_ids)), "YouTube utility rails contain duplicate IDs"
    assert all(rail_id in {"history", "saved"} for rail_id in rail_ids), rail_ids
    assert rail_ids == sorted(rail_ids, key=["history", "saved"].index), rail_ids
    visible_ids = []
    for rail in rails:
        items = (rail or {}).get("items")
        assert isinstance(items, list) and len(items) == 4, rail
        assert rail.get("stale") is False, rail
        for item in items:
            assert isinstance(item, dict) and item.get("kind") == "video", item
            item_id = item.get("id")
            assert isinstance(item_id, str) and item_id.strip(), item
            visible_ids.append(item_id)
    assert len(visible_ids) == len(set(visible_ids)), "YouTube utility cards repeat across rails"
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
  request_id="yt-smoke-$(date +%s%N)"
  post_json "/play-session" "{\"request_id\":\"$request_id\",\"source\":\"youtube\",\"type\":\"youtube_video\",\"id\":\"$video_id\"}" 20 >"$out"
  python3 - "$out" "$CATALOG" <<'PY'
import json, sys, time, urllib.request
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload.get("ok") is True
session = payload.get("session") or {}
session_id = session.get("session_id") or ""
assert session_id, payload
base = sys.argv[2].rstrip("/")
deadline = time.time() + 90
state = session.get("state") or "unknown"
while time.time() < deadline and state not in ("playing", "failed_before_frame", "cancelled", "stopped"):
    req = urllib.request.Request(f"{base}/play-session/{session_id}?wait_ms=2000")
    with urllib.request.urlopen(req, timeout=8) as response:
        payload = json.load(response)
    session = payload.get("session") or {}
    state = session.get("state") or "unknown"
blob = json.dumps(payload)
assert "http://" not in blob.lower()
assert "googlevideo" not in blob.lower()
assert state == "playing", state
result = session.get("result") or {}
assert int(result.get("ttff_ms") or 0) > 0
PY
  python3 - "${MANGO_MPV_SOCKET:-$HOME/.cache/mango/mpv.sock}" <<'PY'
import json
import os
import socket
import sys
import time

sock_path = sys.argv[1]

def ipc(cmd):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(2)
    s.connect(sock_path)
    s.sendall((json.dumps({"command": cmd}) + "\n").encode())
    buf = b""
    while b"\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
    s.close()
    return json.loads(buf.decode())

t0 = time.time()
started = False
for _ in range(40):
    time.sleep(0.5)
    if not os.path.exists(sock_path):
        continue
    try:
        pt = ipc(["get_property", "playback-time"]).get("data")
        if isinstance(pt, (int, float)) and pt >= 0.3:
            started = True
            break
    except Exception:
        continue
assert started, "YouTube play did not start on mpv socket"
last = None
deadline = t0 + 150
while time.time() < deadline:
    time.sleep(10)
    pt = ipc(["get_property", "playback-time"]).get("data")
    aid = ipc(["get_property", "aid"]).get("data")
    last = (pt, aid)
    assert isinstance(pt, (int, float)) and pt >= 0, last
assert last is not None, "YouTube play produced no samples"
pt, aid = last
assert pt >= 120, f"YouTube play died before 120s (playback-time={pt})"
assert aid not in (None, False, "no"), f"YouTube play has no audio (aid={aid})"
print(f"youtube sustained play ok playback_time={pt:.1f}s aid={aid}")
PY
fi

echo "M6.2 YouTube smoke gate ok"

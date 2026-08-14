#!/usr/bin/env bash
# Local fixture coverage for the mode-aware YouTube couch gate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$SCRIPT_DIR/gate-m6-youtube-smoke.sh"
test_tmp_dir="$(mktemp -d)"
mock_pid=""

cleanup() {
  if [[ -n "$mock_pid" ]]; then
    kill "$mock_pid" 2>/dev/null || true
    wait "$mock_pid" 2>/dev/null || true
  fi
  if [[ -d "$test_tmp_dir" && "$test_tmp_dir" != "/" ]]; then
    rm -rf -- "$test_tmp_dir"
  fi
}
trap cleanup EXIT

run_case() {
  local fixture="$1"
  local expectation="$2"
  local port_file="$test_tmp_dir/${fixture}.port"
  local output_file="$test_tmp_dir/${fixture}.out"

  python3 - "$fixture" "$port_file" <<'PY' &
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

fixture, port_file = sys.argv[1:]


def video(video_id):
    return {
        "id": video_id,
        "kind": "video",
        "title": f"Video {video_id}",
        "live_status": "none",
    }


def rail(rail_id, prefix):
    return {
        "rail_id": rail_id,
        "stale": False,
        "items": [video(f"{prefix}-{index}") for index in range(4)],
    }


def pool_quality(depth):
    return {
        "quality_tiers": {
            "A": depth,
            "B": 0,
            "C": 0,
            "rejected": 0,
        },
        "expected_selection_share": {
            "A": 1 if depth else 0,
            "B": 0,
            "C": 0,
        },
        "effective_pool_size": depth,
        "expected_adjacent_overlap": 16 / depth if depth else 0,
        "top_quartile_sampling_share": 0.25 if depth else 0,
        "bottom_quartile_sampling_share": 0.25 if depth else 0,
        "minimum_sampling_weight": 1 if depth else 0,
        "creator_count": depth,
        "seed_count": depth,
    }


allowed_provenance = {
    "subscription_upload": 0,
    "subscription_live": 0,
    "history_channel": 0,
    "history_topic": 12,
}
v2 = {
    "mode": "serve",
    "model_version": "youtube-household-v3.0",
    "status": "ready",
    "setup_required": False,
    "generation": 7,
    "candidate_count": 12,
    "reserve_depths": {
        "for_you": 4,
        "beyond": 4,
        "more_like": 4,
        "new_from_subscriptions": 0,
        "frequently_watched": 0,
        "live_now": 0,
    },
    "pool_quality": {
        "for_you": pool_quality(4),
        "beyond": pool_quality(4),
        "more_like": pool_quality(4),
        "new_from_subscriptions": pool_quality(0),
        "frequently_watched": pool_quality(0),
        "live_now": pool_quality(0),
    },
    "sampling": {
        "policy": "independent_weighted_v1",
        "independent_epoch_draws": True,
        "without_replacement_scope": "visible_slate",
        "impression_aware": False,
        "recent_slate_state": False,
    },
    "quality_policy": {
        "tiers": {"A_min": 0.65, "B_min": 0.38, "C_min": 0.20},
        "c_candidates_per_rail": 64,
    },
    "caps": {"reserve_per_rail": 512, "more_like_target": 512},
    "provenance": {
        "total": 12,
        "active": 12,
        "expired": 0,
        "next_expiry_at": 9999999999999,
        "by_provenance": allowed_provenance,
    },
    "history_acquisition": {"stop_reason": "source_exhausted"},
    "more_like_status": {"status": "thematic"},
    "source_stale": {
        "stale": False,
        "reason": None,
        "error_category": None,
        "at": None,
        "authoritative_subscription_count": 0,
    },
}
rails = [
    rail("for_you", "for-you"),
    rail("more_like", "more-like"),
    rail("beyond", "beyond"),
]
payload = {
    "ok": True,
    "setup_required": False,
    "recommendations_status": "ready",
    "stale_reason": None,
    "rails": rails,
}

if fixture == "serve-ready-duplicate":
    payload["rails"][1]["items"][0]["id"] = payload["rails"][0]["items"][0]["id"]
elif fixture == "serve-ready-missing-core":
    payload["rails"] = [rail for rail in payload["rails"] if rail["rail_id"] != "beyond"]
    v2["candidate_count"] = 8
    v2["reserve_depths"]["beyond"] = 0
    v2["pool_quality"]["beyond"] = pool_quality(0)
elif fixture == "serve-ready-visible-shallow":
    v2["candidate_count"] = 11
    v2["reserve_depths"]["beyond"] = 3
    v2["pool_quality"]["beyond"] = pool_quality(3)
elif fixture in {"serve-setup", "serve-pristine-setup"}:
    v2.update({
        "status": "setup",
        "setup_required": True,
        "generation": None,
        "candidate_count": 0,
        "reserve_depths": {key: 0 for key in v2["reserve_depths"]},
        "pool_quality": {key: pool_quality(0) for key in v2["pool_quality"]},
        "provenance": {
            "total": 0,
            "active": 0,
            "expired": 0,
            "next_expiry_at": None,
            "by_provenance": {key: 0 for key in allowed_provenance},
        },
        "more_like_status": {"status": "not_applicable"},
        "history_acquisition": {
            "skipped": "no_history_or_subscription_seed" if fixture == "serve-setup" else None,
            "stop_reason": None,
            "query_failures": 0,
        },
    })
    payload.update({
        "setup_required": True,
        "recommendations_status": "setup",
        "stale_reason": None,
        "rails": [rail("saved", "saved")],
    })
elif fixture == "serve-wall-limit":
    v2["history_acquisition"] = {
        "skipped": None,
        "stop_reason": "wall_limit",
        "query_failures": 0,
    }
elif fixture == "serve-publication-failed":
    v2.update({
        "status": "stale",
        "source_stale": {
            "stale": True,
            "reason": "publication_failed",
            "error_category": "publication",
            "at": 9999999999000,
            "authoritative_subscription_count": 0,
        },
    })
    payload.update({
        "recommendations_status": "stale",
        "stale_reason": "publication_failed",
    })
    for entry in payload["rails"]:
        entry["stale"] = True
elif fixture == "serve-stale-state-mismatch":
    v2["status"] = "stale"
    payload.update({
        "recommendations_status": "stale",
        "stale_reason": None,
    })
    for entry in payload["rails"]:
        entry["stale"] = True
elif fixture == "serve-stale-rail-mismatch":
    v2.update({
        "status": "stale",
        "source_stale": {
            "stale": True,
            "reason": "publication_failed",
            "error_category": "publication",
            "at": 9999999999000,
            "authoritative_subscription_count": 0,
        },
    })
    payload.update({
        "recommendations_status": "stale",
        "stale_reason": "publication_failed",
    })
elif fixture == "serve-invalid-provenance":
    v2["provenance"]["by_provenance"] = {
        **allowed_provenance,
        "search_cache": 1,
    }
elif fixture == "serve-status-mismatch":
    payload["recommendations_status"] = "stale"
elif fixture == "serve-invalid-sampling":
    v2["sampling"]["policy"] = "deal_through"
elif fixture == "serve-invalid-cap":
    v2["caps"]["reserve_per_rail"] = 120
elif fixture == "serve-invalid-more-like-target":
    v2["caps"]["more_like_target"] = 240
elif fixture == "serve-diagnostics-leak":
    v2["pool_quality"]["for_you"]["debug"] = {
        "url": "https://private.example/watch?token=secret",
    }
elif fixture == "shadow-utility":
    v2 = {"mode": "shadow"}
    payload = {
        "ok": True,
        "setup_required": False,
        "recommendations_status": "setup",
        "stale_reason": None,
        "rails": [rail("history", "history"), rail("saved", "saved")],
    }
elif fixture == "off-utility":
    v2 = {"mode": "off"}
    payload = {
        "ok": True,
        "setup_required": False,
        "recommendations_status": "setup",
        "stale_reason": None,
        "rails": [rail("history", "history"), rail("saved", "saved")],
    }
elif fixture == "off-empty":
    v2 = {"mode": "off"}
    payload = {
        "ok": True,
        "setup_required": False,
        "recommendations_status": "setup",
        "stale_reason": None,
        "rails": [],
    }
elif fixture == "off-legacy":
    v2 = {"mode": "off"}
    payload = {
        "ok": True,
        "setup_required": False,
        "recommendations_status": "setup",
        "stale_reason": None,
        "rails": [{"rail_id": "fresh_finds", "items": []}],
    }
elif fixture == "off-custom-command":
    v2 = {"mode": "off"}
    payload = {
        "ok": True,
        "setup_required": False,
        "recommendations_status": "setup",
        "stale_reason": None,
        "rails": [],
    }
elif fixture != "serve-ready":
    raise SystemExit(f"unknown fixture: {fixture}")

state = {
    "ok": True,
    "enabled": True,
    "configured": {
        "api_key": False,
        "yt_dlp_command": "",
        "yt_dlp_command_kind": "custom" if fixture == "off-custom-command" else "missing",
    },
    "cache": {},
    "recommendations_v2": v2,
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = {"ok": True}
        elif self.path == "/youtube/state":
            body = state
        elif self.path == "/youtube/rails":
            body = payload
        else:
            self.send_error(404)
            return
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format, *_args):
        return


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
Path(port_file).write_text(str(server.server_address[1]), encoding="utf-8")
server.serve_forever()
PY
  mock_pid="$!"

  for _ in $(seq 1 100); do
    [[ -s "$port_file" ]] && break
    kill -0 "$mock_pid" 2>/dev/null || {
      echo "FAIL: mock server exited for $fixture" >&2
      return 1
    }
    sleep 0.02
  done
  [[ -s "$port_file" ]] || {
    echo "FAIL: mock server did not publish a port for $fixture" >&2
    return 1
  }

  local port
  port="$(<"$port_file")"
  local rc=0
  MANGO_CATALOG_URL="http://127.0.0.1:${port}" bash "$GATE" >"$output_file" 2>&1 || rc=$?

  kill "$mock_pid" 2>/dev/null || true
  wait "$mock_pid" 2>/dev/null || true
  mock_pid=""

  if [[ "$expectation" == "pass" && "$rc" -ne 0 ]]; then
    echo "FAIL: $fixture should pass" >&2
    sed -n '1,120p' "$output_file" >&2
    exit 1
  fi
  if [[ "$expectation" == "fail" && "$rc" -eq 0 ]]; then
    echo "FAIL: $fixture should fail" >&2
    sed -n '1,120p' "$output_file" >&2
    exit 1
  fi
  echo "PASS: $fixture ($expectation)"
}

run_case serve-ready pass
run_case serve-ready-duplicate fail
run_case serve-ready-missing-core pass
run_case serve-ready-visible-shallow fail
run_case serve-setup pass
run_case serve-pristine-setup pass
run_case serve-wall-limit pass
run_case serve-publication-failed pass
run_case serve-stale-state-mismatch fail
run_case serve-stale-rail-mismatch fail
run_case serve-invalid-provenance fail
run_case serve-status-mismatch fail
run_case serve-invalid-sampling fail
run_case serve-invalid-cap fail
run_case serve-invalid-more-like-target fail
run_case serve-diagnostics-leak fail
run_case shadow-utility pass
run_case off-utility pass
run_case off-empty pass
run_case off-legacy fail
run_case off-custom-command fail

echo "PASS: mode-aware YouTube smoke fixtures"

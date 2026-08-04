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
        "items": [video(f"{prefix}-{index}") for index in range(4)],
    }


allowed_provenance = {
    "subscription_upload": 0,
    "subscription_live": 0,
    "history_channel": 0,
    "history_topic": 12,
}
v2 = {
    "mode": "serve",
    "model_version": "youtube-household-v2.2",
    "status": "ready",
    "setup_required": False,
    "generation": 7,
    "candidate_count": 12,
    "reserve_depths": {
        "for_you": 4,
        "beyond": 4,
        "more_like": 4,
        "new_from_subscriptions": 0,
        "live_now": 0,
    },
    "provenance": {
        "total": 12,
        "active": 12,
        "expired": 0,
        "next_expiry_at": 9999999999999,
        "by_provenance": allowed_provenance,
    },
    "source_stale": {"stale": False, "reason": None, "at": None},
}
rails = [
    rail("for_you", "for-you"),
    rail("beyond", "beyond"),
    rail("more_like", "more-like"),
]
payload = {
    "ok": True,
    "setup_required": False,
    "recommendations_status": "ready",
    "rails": rails,
}

if fixture == "serve-ready-duplicate":
    payload["rails"][1]["items"][0]["id"] = payload["rails"][0]["items"][0]["id"]
elif fixture == "serve-ready-missing-core":
    payload["rails"] = payload["rails"][:2]
    v2["candidate_count"] = 8
    v2["reserve_depths"]["more_like"] = 0
elif fixture == "serve-setup":
    v2.update({
        "status": "setup",
        "setup_required": True,
        "generation": None,
        "candidate_count": 0,
        "reserve_depths": {key: 0 for key in v2["reserve_depths"]},
        "provenance": {
            "total": 0,
            "active": 0,
            "expired": 0,
            "next_expiry_at": None,
            "by_provenance": {key: 0 for key in allowed_provenance},
        },
    })
    payload.update({
        "setup_required": True,
        "recommendations_status": "setup",
        "rails": [rail("saved", "saved")],
    })
elif fixture == "serve-invalid-provenance":
    v2["provenance"]["by_provenance"] = {
        **allowed_provenance,
        "search_cache": 1,
    }
elif fixture == "serve-status-mismatch":
    payload["recommendations_status"] = "stale"
elif fixture == "off-legacy":
    v2 = {"mode": "off"}
    payload = {
        "ok": True,
        "rails": [{"rail_id": "fresh_finds", "items": []}],
    }
elif fixture != "serve-ready":
    raise SystemExit(f"unknown fixture: {fixture}")

state = {
    "ok": True,
    "enabled": True,
    "configured": {"api_key": False, "yt_dlp_command": ""},
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
run_case serve-ready-missing-core fail
run_case serve-setup pass
run_case serve-invalid-provenance fail
run_case serve-status-mismatch fail
run_case off-legacy pass

echo "PASS: mode-aware YouTube smoke fixtures"

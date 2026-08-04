#!/usr/bin/env bash
# Local mock-server coverage for exact YouTube refresh-job polling.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REFRESH="$SCRIPT_DIR/youtube-refresh-cache.sh"
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
  local expected_text="$3"
  local timeout_sec="${4:-3}"
  local port_file="$test_tmp_dir/${fixture}.port"
  local output_file="$test_tmp_dir/${fixture}.out"

  python3 - "$fixture" "$port_file" <<'PY' &
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

fixture, port_file = sys.argv[1:]
job_id = f"job-{fixture}"


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        if length:
            self.rfile.read(length)
        if self.path != "/youtube/refresh":
            self.send_error(404)
            return
        self.send_json(202, {
            "ok": True,
            "job": {"job_id": job_id, "status": "queued"},
        })

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"ok": True})
            return
        if self.path == f"/recommendations/jobs/{job_id}":
            if fixture == "not-found":
                self.send_json(404, {"ok": False, "error": "not found"})
                return
            if fixture == "missing":
                self.send_json(200, {"ok": True, "job": None})
                return
            status = {
                "complete": "complete",
                "coalesced": "coalesced",
                "failed": "failed",
                "timeout": "running",
            }[fixture]
            self.send_json(200, {
                "ok": status != "failed",
                "job": {
                    "job_id": job_id,
                    "status": status,
                    "error": "fixture failure" if status == "failed" else None,
                },
            })
            return
        if self.path == "/youtube/state":
            self.send_json(200, {
                "ok": True,
                "refresh": {
                    "last_success_at": 123456,
                    "quota_used_today": 2,
                    "quota_reset_day": "2099-01-01",
                    "phase_results": [{"phase": "publish", "ok": True}],
                },
            })
            return
        self.send_error(404)

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
  MANGO_REPO_DIR="$REPO_DIR" \
    MANGO_CATALOG_URL="http://127.0.0.1:${port}" \
    bash "$REFRESH" --reason "fixture_${fixture}" --timeout-sec "$timeout_sec" \
      >"$output_file" 2>&1 || rc=$?

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
  if ! grep -Fq "$expected_text" "$output_file"; then
    echo "FAIL: $fixture output did not contain: $expected_text" >&2
    sed -n '1,120p' "$output_file" >&2
    exit 1
  fi
  echo "PASS: $fixture ($expectation)"
}

run_case complete pass "terminal job_id=job-complete"
run_case coalesced pass "terminal job_id=job-coalesced"
run_case failed fail "job job-failed failed: fixture failure"
run_case timeout fail "timed out after 1s (status=running)" 1
run_case missing fail "job job-missing unavailable"
run_case not-found fail "exact job lookup failed for job-not-found"

echo "PASS: exact YouTube refresh-job polling fixtures"

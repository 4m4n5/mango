#!/usr/bin/env bash
# Regression: optional disabled Live must not trigger watchdog catalog repair,
# while configured/malformed Live remains unhealthy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPAIR="$REPO_DIR/scripts/mango-health-repair.sh"

run_case() {
  local name="$1" expected="$2" payload="$3"
  set +e
  MANGO_HEALTH_REPAIR_TEST_CATALOG_READY=1 bash "$REPAIR" <<<"$payload" >/tmp/mango-health-repair-live-contract.out 2>/tmp/mango-health-repair-live-contract.err
  local status=$?
  set -e
  if [[ "$expected" == "pass" && "$status" -ne 0 ]]; then
    echo "FAIL: $name expected healthy, got status $status" >&2
    cat /tmp/mango-health-repair-live-contract.err >&2 || true
    exit 1
  fi
  if [[ "$expected" == "fail" && "$status" -eq 0 ]]; then
    echo "FAIL: $name expected unhealthy" >&2
    exit 1
  fi
}

base='{"ok":true,"core":"ready","rails_ready":true'

run_case "explicit disabled live" pass \
  "${base},\"live_rails\":0,\"live_ready\":false,\"live\":{\"ready\":false,\"config_ready\":false,\"sources\":[],\"cache\":{\"fresh\":false,\"non_empty\":false}}}"

run_case "configured broken live source" fail \
  "${base},\"live_rails\":1,\"live_ready\":false,\"live\":{\"ready\":false,\"config_ready\":false,\"sources\":[{\"addon\":\"mango Live TV\",\"catalog\":\"tv\"}],\"cache\":{\"fresh\":false,\"non_empty\":false}}}"

run_case "malformed live config" fail \
  "${base},\"live_rails\":0,\"live_ready\":false,\"live\":{\"ready\":false,\"config_ready\":false,\"config_error\":\"live catalog rails must be a non-empty array\",\"sources\":[]}}"

run_case "malformed live rail count" fail \
  "${base},\"live_rails\":\"oops\",\"live_ready\":false,\"live\":{\"ready\":false,\"config_ready\":false,\"sources\":[]}}"

run_case "malformed live sources" fail \
  "${base},\"live_rails\":0,\"live_ready\":false,\"live\":{\"ready\":false,\"config_ready\":false,\"sources\":{\"addon\":\"mango Live TV\"}}}"

run_case "configured live missing readiness fields" fail \
  "${base},\"live_rails\":1,\"live\":{\"config_ready\":true,\"sources\":[{\"addon\":\"mango Live TV\",\"catalog\":\"tv\"}]}}"

run_case "configured live ready" pass \
  "${base},\"live_rails\":1,\"live_ready\":true,\"live\":{\"ready\":true,\"config_ready\":true,\"sources\":[{\"addon\":\"mango Live TV\",\"catalog\":\"tv\"}]}}"

run_case "legacy no live fields" pass \
  "${base}}"

run_case "legacy top-level live_ready false" fail \
  "${base},\"live_ready\":false}"

run_case "legacy nested live ready false" fail \
  "${base},\"live\":{\"ready\":false}}"

rm -f /tmp/mango-health-repair-live-contract.out /tmp/mango-health-repair-live-contract.err
echo "PASS: health-repair optional Live contract"

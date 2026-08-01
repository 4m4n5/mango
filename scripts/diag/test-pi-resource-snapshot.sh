#!/usr/bin/env bash
# Pure decoder contract tests; no Raspberry Pi hardware required.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAPSHOT="$SCRIPT_DIR/pi-resource-snapshot.sh"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] || {
    echo "FAIL: expected '$needle' in: $haystack" >&2
    exit 1
  }
}

OUTPUT="$($SNAPSHOT --decode-throttled 0x0)"
assert_contains "$OUTPUT" "throttle_verdict=OK"

OUTPUT="$($SNAPSHOT --decode-throttled 0x80000)"
assert_contains "$OUTPUT" "throttle_verdict=WARN"
assert_contains "$OUTPUT" "throttle_history=soft-temperature-limit"

OUTPUT="$($SNAPSHOT --decode-throttled 0x2)"
assert_contains "$OUTPUT" "throttle_verdict=WARN"
assert_contains "$OUTPUT" "throttle_active=frequency-capped"

if OUTPUT="$($SNAPSHOT --decode-throttled 0x1)"; then
  echo "FAIL: active undervoltage must return nonzero" >&2
  exit 1
fi
assert_contains "$OUTPUT" "throttle_verdict=FAIL"
assert_contains "$OUTPUT" "throttle_active=undervoltage"

if OUTPUT="$($SNAPSHOT --decode-throttled 0x4)"; then
  echo "FAIL: active throttling must return nonzero" >&2
  exit 1
fi
assert_contains "$OUTPUT" "throttle_verdict=FAIL"
assert_contains "$OUTPUT" "throttle_active=throttled"

echo "PASS: throttle decoder active/sticky contract"

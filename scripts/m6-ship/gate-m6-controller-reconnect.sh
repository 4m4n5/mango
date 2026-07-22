#!/usr/bin/env bash
# Pi-only proof that Mango has exactly one Bluetooth link owner and one pad owner.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
BT_MAC="${MANGO_GAMEPAD_BT_MAC:-E4:17:D8:EB:00:44}"
STATUS_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/mango/mango-controller-link-status.json"

failures=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*" >&2; failures=$((failures + 1)); }

systemctl is-active --quiet mango-controller-link.service \
  && pass "controller link service active" \
  || fail "controller link service inactive"
systemctl --user is-active --quiet mango-tv-pad.service \
  && pass "pad router active" \
  || fail "pad router inactive"

link_count="$(pgrep -fc '[m]ango-controller-link\.py' 2>/dev/null || true)"
pad_count="$(pgrep -fc '[m]ango-tv-pad\.py' 2>/dev/null || true)"
[[ "$link_count" == "1" ]] && pass "one link owner" || fail "expected one link owner, got ${link_count:-0}"
[[ "$pad_count" == "1" ]] && pass "one pad owner" || fail "expected one pad owner, got ${pad_count:-0}"

if pgrep -f '^bluetoothctl connect E4:17:D8:EB:00:44$' >/dev/null 2>&1; then
  fail "orphan bluetoothctl connect process"
else
  pass "no orphan bluetoothctl connect"
fi

if [[ -f /etc/udev/rules.d/99-mango-pro-controller.rules ]] \
  && grep -q 'scripts/phase0/on-pro-controller-connect.sh' /etc/udev/rules.d/99-mango-pro-controller.rules; then
  fail "stale Phase 0 udev hook remains"
else
  pass "no stale Phase 0 udev hook"
fi

info="$(bluetoothctl info "$BT_MAC" 2>/dev/null || true)"
for expected in 'Paired: yes' 'Bonded: yes' 'Trusted: yes' 'Blocked: no' 'WakeAllowed: yes'; do
  grep -q "$expected" <<<"$info" && pass "controller ${expected}" || fail "controller missing ${expected}"
done

if python3 - <<'PY'
import configparser

parser = configparser.ConfigParser(strict=False, interpolation=None)
parser.optionxform = str
parser.read('/etc/bluetooth/main.conf')
expected = {
    ('General', 'FastConnectable'): 'true',
    ('General', 'AlwaysPairable'): 'false',
    ('Policy', 'AutoEnable'): 'true',
    ('Policy', 'ReconnectUUIDs'): '00001124-0000-1000-8000-00805f9b34fb',
    ('Policy', 'ReconnectAttempts'): '7',
    ('Policy', 'ReconnectIntervals'): '1,2,4,8,16,32,64',
}
for (section, key), value in expected.items():
    actual = parser.get(section, key, fallback='')
    if actual != value:
        raise SystemExit(f'{section}/{key}: expected {value!r}, got {actual!r}')
PY
then
  pass "BlueZ Mango reconnect policy"
else
  fail "BlueZ Mango reconnect policy"
fi

if [[ -s "$STATUS_FILE" ]]; then
  python3 - "$STATUS_FILE" <<'PY' || exit 1
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
state = data.get("state")
age = __import__("time").time() - float(data.get("updated_at") or 0)
allowed = {"ready", "connected_waiting_for_input", "connecting", "fast_retry", "maintenance_retry"}
print(f"controller status: state={state} age={age:.1f}s")
if state not in allowed:
    raise SystemExit(f"unexpected controller state: {state}")
if age > 10:
    raise SystemExit(f"controller status stale: {age:.1f}s")
PY
  pass "controller status is fresh and couch-safe"
else
  fail "controller status missing"
fi

if (( failures > 0 )); then
  echo "Controller reconnect gate failed (${failures})" >&2
  exit 1
fi
echo "Controller reconnect gate passed"

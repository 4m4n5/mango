#!/usr/bin/env bash
# Verify mango-tv-pad owns the currently connected Pro Controller event node.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$HOME/mango}"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/mango"
STATUS_FILE="${CACHE_DIR}/mango-tv-pad-status.json"
PID_FILE="${CACHE_DIR}/mango-tv-pad.pid"
MAX_STATUS_AGE_SEC="${MANGO_PAD_HEALTH_MAX_AGE_SEC:-8}"
REPAIR_WAIT_STEPS="${MANGO_PAD_REPAIR_WAIT_STEPS:-24}"
BT_MAC="${MANGO_GAMEPAD_BT_MAC:-E4:17:D8:EB:00:44}"

QUIET=0
JSON=0
REPAIR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet) QUIET=1; shift ;;
    --json) JSON=1; shift ;;
    --repair) REPAIR=1; shift ;;
    -h|--help)
      echo "usage: $0 [--quiet] [--json] [--repair]"
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() {
  [[ "$QUIET" == "1" ]] || echo "$*"
}

current_controller_path() {
  python3 - <<'PY'
import sys
try:
    import evdev
    from evdev import ecodes
except ImportError:
    raise SystemExit(2)

required_keys = {304, 308}
stick_abs = {ecodes.ABS_X, ecodes.ABS_Y}
hat_abs = {ecodes.ABS_HAT0X, ecodes.ABS_HAT0Y}
for path in evdev.list_devices():
    dev = evdev.InputDevice(path)
    if dev.name != "Pro Controller":
        continue
    caps = dev.capabilities()
    keys = set(caps.get(ecodes.EV_KEY, []))
    abs_axes = {
        item[0] if isinstance(item, tuple) else item
        for item in caps.get(ecodes.EV_ABS, [])
    }
    dev.close()
    if required_keys.issubset(keys) and (
        stick_abs.issubset(abs_axes) or hat_abs.issubset(abs_axes)
    ):
        print(path)
        raise SystemExit(0)
raise SystemExit(1)
PY
}

pad_pids() {
  pgrep -f '[m]ango-tv-pad\.py' 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true
}

input_remapper_active() {
  systemctl is-active --quiet input-remapper 2>/dev/null \
    || systemctl --user is-active --quiet input-remapper 2>/dev/null
}

cleanup_bt_connect() {
  pkill -f "[b]luetoothctl connect ${BT_MAC}" 2>/dev/null || true
}

load_status_exports() {
  python3 - "$STATUS_FILE" <<'PY'
import json
import shlex
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    data = {}

def emit(name, value):
    print(f"{name}={shlex.quote(str(value or ''))}")

emit("STATUS_PID", data.get("pid", ""))
emit("STATUS_STATE", data.get("state", ""))
emit("STATUS_PATH", data.get("device_path", ""))
emit("STATUS_UPDATED_AT", data.get("updated_at", "0"))
emit("STATUS_ACTION", data.get("last_action", ""))
PY
}

json_result() {
  local ok="$1" reason="$2" current_path="$3" pids="$4"
  python3 - "$ok" "$reason" "$current_path" "$pids" "$STATUS_FILE" "$PID_FILE" <<'PY'
import json
import sys
from pathlib import Path

ok = sys.argv[1] == "1"
reason = sys.argv[2]
current_path = sys.argv[3]
pids = [p for p in sys.argv[4].split() if p]
status_path = Path(sys.argv[5])
pid_file = Path(sys.argv[6])
try:
    status = json.loads(status_path.read_text(encoding="utf-8"))
except Exception:
    status = {}
try:
    pid_file_value = pid_file.read_text(encoding="utf-8").strip()
except Exception:
    pid_file_value = ""
print(json.dumps({
    "ok": ok,
    "reason": reason,
    "current_device_path": current_path,
    "pids": pids,
    "pid_file": pid_file_value,
    "status": status,
}, separators=(",", ":")))
PY
}

check_health() {
  local current_path pids now updated age
  REASON="ok"
  CURRENT_PATH="$(current_controller_path 2>/dev/null || true)"
  PIDS="$(pad_pids)"

  if [[ -z "$CURRENT_PATH" ]]; then
    REASON="controller_event_missing"
    return 1
  fi
  if [[ -z "$PIDS" ]]; then
    REASON="pad_process_missing"
    return 1
  fi
  if input_remapper_active; then
    REASON="input_remapper_active_with_tv_pad"
    return 1
  fi
  if [[ ! -s "$STATUS_FILE" ]]; then
    REASON="status_missing"
    return 1
  fi

  eval "$(load_status_exports)"
  if [[ -z "${STATUS_PID:-}" || " ${PIDS} " != *" ${STATUS_PID} "* ]]; then
    REASON="status_pid_mismatch"
    return 1
  fi
  if [[ "${STATUS_PATH:-}" != "$CURRENT_PATH" ]]; then
    REASON="stale_device:${STATUS_PATH:-missing}->${CURRENT_PATH}"
    return 1
  fi
  if [[ "${STATUS_STATE:-}" != "running" ]]; then
    REASON="status_state:${STATUS_STATE:-missing}"
    return 1
  fi

  now="$(date +%s)"
  updated="$(python3 - "${STATUS_UPDATED_AT:-0}" <<'PY'
import sys
try:
    print(int(float(sys.argv[1])))
except Exception:
    print(0)
PY
)"
  age=$(( now - updated ))
  if (( age > MAX_STATUS_AGE_SEC )); then
    REASON="status_stale:${age}s"
    return 1
  fi
  return 0
}

repair_pad() {
  mkdir -p "$CACHE_DIR"
  cleanup_bt_connect
  bash "$REPO_DIR/scripts/lib/stop-input-remapper.sh" >/dev/null 2>&1 || true
  bash "$REPO_DIR/scripts/m1-foundation/pad/connect-gamepad.sh" >/dev/null 2>&1 || true
  if systemctl --user is-enabled mango-tv-pad.service >/dev/null 2>&1; then
    systemctl --user restart mango-tv-pad.service || true
  else
    bash "$REPO_DIR/scripts/m1-foundation/pad/start-mango-tv-pad.sh" >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 "$REPAIR_WAIT_STEPS"); do
    sleep 0.5
    if check_health; then
      return 0
    fi
  done
  cleanup_bt_connect
  return 1
}

CURRENT_PATH=""
PIDS=""
REASON="ok"

if check_health; then
  say "pad-health: ok (${CURRENT_PATH})"
  [[ "$JSON" == "1" ]] && json_result 1 "$REASON" "$CURRENT_PATH" "$PIDS"
  exit 0
fi

if [[ "$REPAIR" == "1" ]]; then
  say "pad-health: repairing (${REASON})"
  if repair_pad && check_health; then
    say "pad-health: repaired (${CURRENT_PATH})"
    [[ "$JSON" == "1" ]] && json_result 1 "repaired" "$CURRENT_PATH" "$PIDS"
    exit 0
  fi
fi

say "pad-health: fail (${REASON})"
[[ "$JSON" == "1" ]] && json_result 0 "$REASON" "$CURRENT_PATH" "$PIDS"
exit 1

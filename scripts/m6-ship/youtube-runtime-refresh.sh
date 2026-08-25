#!/usr/bin/env bash
# Build, canary, and atomically promote Mango's volatile yt-dlp runtime.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SLOT_ROOT="${MANGO_YTDLP_SLOT_ROOT:-$HOME/.local/share/mango/ytdlp-slots}"
REVISIONS="$SLOT_ROOT/revisions"
ACTIVE="$SLOT_ROOT/active"
PREVIOUS="$SLOT_ROOT/previous"
STAMP="$SLOT_ROOT/.mango-last-check"
REQUEST="${MANGO_YTDLP_REFRESH_REQUEST:-$HOME/.cache/mango/youtube-runtime-refresh.request}"
LOCK_DIR="$SLOT_ROOT/.refresh-lock"
CHANNEL="${MANGO_YTDLP_CHANNEL:-nightly}"
INTERVAL_SEC="${MANGO_YTDLP_UPDATE_INTERVAL_SEC:-86400}"
DENO_BIN="${MANGO_DENO:-$HOME/.local/share/mango/deno/bin/deno}"
CANARY="$SCRIPT_DIR/youtube-runtime-canary.py"
UPDATE_MODE="${MANGO_YTDLP_UPDATE:-auto}"
STAGING=""

if [[ -n "${MANGO_YTDLP_TEST_BIN:-}" && "${MANGO_YTDLP_TEST_MODE:-0}" != "1" ]]; then
  echo "youtube runtime: test candidate requires MANGO_YTDLP_TEST_MODE=1" >&2
  exit 2
fi

case "$CHANNEL" in
  stable | nightly | master) ;;
  *)
    echo "youtube runtime: unsupported channel $CHANNEL" >&2
    exit 2
    ;;
esac

mkdir -p "$REVISIONS" "$(dirname "$REQUEST")"

schedule_deferred_refresh() {
  if command -v systemctl >/dev/null 2>&1 \
    && systemctl --user cat mango-youtube-runtime-retry.timer >/dev/null 2>&1 \
    && systemctl --user restart mango-youtube-runtime-retry.timer; then
    rm -f "$REQUEST"
    return 0
  fi
  return 1
}

now_epoch() {
  python3 - <<'PY'
import time
print(int(time.time()))
PY
}

file_mtime() {
  python3 - "$1" <<'PY'
import os
import sys
try:
    print(int(os.path.getmtime(sys.argv[1])))
except OSError:
    print(0)
PY
}

real_path() {
  python3 - "$1" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
}

slot_canaried() {
  local slot_root="$1"
  [[ -x "$slot_root/venv/bin/yt-dlp" && -f "$slot_root/meta.json" ]] || return 1
  python3 - "$slot_root/meta.json" "$CHANNEL" <<'PY'
import json
import math
import sys

try:
    meta = json.load(open(sys.argv[1], encoding="utf-8"))
    result = meta.get("canary_result") or {}
    total = float(result.get("total"))
    passed = float(result.get("passed"))
    required_total = float(result.get("required_total"))
    required_passed = float(result.get("required_passed"))
    dynamic_total = float(result.get("dynamic_total"))
    dynamic_passed = float(result.get("dynamic_passed"))
    ok = (
        isinstance(meta.get("revision"), str)
        and bool(meta["revision"].strip())
        and meta.get("channel") == sys.argv[2]
        and meta.get("ejs") is True
        and meta.get("js_runtime") in {"deno", "node"}
        and meta.get("canary") == "pass"
        and result.get("ok") is True
        and result.get("transport") is True
        and all(math.isfinite(value) for value in (
            total, passed, required_total, required_passed,
            dynamic_total, dynamic_passed,
        ))
        and total >= required_total
        and passed >= required_passed
        and passed <= total
        and required_total >= 3
        and required_passed == required_total
        and 0 <= dynamic_total <= required_total
        and dynamic_passed == dynamic_total
    )
except Exception:
    ok = False
raise SystemExit(0 if ok else 1)
PY
}

existing_runtime() {
  slot_canaried "$ACTIVE"
}

needs_refresh=0
if ! slot_canaried "$ACTIVE"; then
  needs_refresh=1
elif [[ "$UPDATE_MODE" == "0" ]]; then
  needs_refresh=0
elif [[ -f "$REQUEST" || "$UPDATE_MODE" == "1" ]]; then
  needs_refresh=1
else
  age=$(( $(now_epoch) - $(file_mtime "$STAMP") ))
  if [[ "$age" -ge "$INTERVAL_SEC" ]]; then
    needs_refresh=1
  fi
fi

if [[ "$needs_refresh" != "1" ]]; then
  echo "youtube runtime: active=$("$ACTIVE/venv/bin/yt-dlp" --version) channel=$CHANNEL (check not due)"
  exit 0
fi

if [[ "${MANGO_YTDLP_ALLOW_DURING_PLAYBACK:-0}" != "1" ]] \
  && command -v pgrep >/dev/null 2>&1 \
  && pgrep -x mpv >/dev/null 2>&1; then
  schedule_deferred_refresh || true
  echo "youtube runtime: refresh deferred while mpv is active"
  exit 75
fi

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" >"$LOCK_DIR/pid"
    return 0
  fi
  local owner=""
  if [[ -f "$LOCK_DIR/pid" ]]; then
    owner="$(tr -dc '0-9' <"$LOCK_DIR/pid" 2>/dev/null || true)"
  fi
  if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
    echo "youtube runtime: refresh already running"
    return 1
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo "$$" >"$LOCK_DIR/pid"
}

if ! acquire_lock; then
  exit 0
fi

cleanup() {
  if [[ -n "$STAGING" && -d "$STAGING" ]]; then
    rm -rf "$STAGING"
  fi
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT

atomic_symlink() {
  python3 - "$1" "$2" <<'PY'
import os
import pathlib
import sys

target = os.path.realpath(sys.argv[1])
link = pathlib.Path(sys.argv[2])
tmp = link.with_name(f".{link.name}.tmp.{os.getpid()}")
try:
    tmp.unlink()
except FileNotFoundError:
    pass
os.symlink(target, tmp)
os.replace(tmp, link)
PY
}

record_failed_canary() {
  local source="$1"
  python3 - "$source" "$SLOT_ROOT/last-canary.json" "$CHANNEL" <<'PY'
import json
import os
import pathlib
import sys
import time

try:
    canary = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    canary = {"ok": False, "failures": {"invalid_result": 1}}
payload = {
    "channel": sys.argv[3],
    "checked_at": int(time.time() * 1000),
    "canary": canary,
}
dest = pathlib.Path(sys.argv[2])
tmp = dest.with_name(f".{dest.name}.tmp.{os.getpid()}")
tmp.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
os.replace(tmp, dest)
PY
}

STAGING="$SLOT_ROOT/.candidate.$$"
rm -rf "$STAGING"
mkdir -p "$STAGING/venv/bin"

if [[ -n "${MANGO_YTDLP_TEST_BIN:-}" ]]; then
  install -m 0755 "$MANGO_YTDLP_TEST_BIN" "$STAGING/venv/bin/yt-dlp"
  revision="${MANGO_YTDLP_TEST_REVISION:-test-$(now_epoch)}"
  plugin_version="test"
else
  python3 -m venv "$STAGING/venv"
  pip_args=(--quiet --disable-pip-version-check --no-input --upgrade pip)
  case "$CHANNEL" in
    stable)
      packages=("yt-dlp[default]" bgutil-ytdlp-pot-provider)
      ;;
    nightly)
      pip_args+=(--pre)
      packages=("yt-dlp[default]" bgutil-ytdlp-pot-provider)
      ;;
    master)
      packages=(
        "yt-dlp[default] @ https://github.com/yt-dlp/yt-dlp/archive/refs/heads/master.tar.gz"
        bgutil-ytdlp-pot-provider
      )
      ;;
  esac
  if ! "$STAGING/venv/bin/python" -m pip install "${pip_args[@]}" "${packages[@]}"; then
    echo "youtube runtime: candidate install failed; keeping current runtime" >&2
    if existing_runtime; then
      exit 0
    fi
    exit 1
  fi
  revision="$("$STAGING/venv/bin/yt-dlp" --version | awk 'NF { print $1; exit }')"
  plugin_version="$("$STAGING/venv/bin/python" - <<'PY'
from importlib.metadata import PackageNotFoundError, version
try:
    print(version("bgutil-ytdlp-pot-provider"))
except PackageNotFoundError:
    print("missing")
PY
)"
fi

if [[ -z "$revision" ]]; then
  echo "youtube runtime: candidate has no revision" >&2
  if existing_runtime; then
    exit 0
  fi
  exit 1
fi

active_revision=""
active_plugin_version=""
if [[ -f "$ACTIVE/meta.json" ]]; then
  active_revision="$(python3 - "$ACTIVE/meta.json" <<'PY'
import json
import sys
try:
    print(str(json.load(open(sys.argv[1], encoding="utf-8")).get("revision") or ""))
except Exception:
    print("")
PY
)"
  active_plugin_version="$(python3 - "$ACTIVE/meta.json" <<'PY'
import json
import sys
try:
    print(str(json.load(open(sys.argv[1], encoding="utf-8")).get("pot_plugin_version") or ""))
except Exception:
    print("")
PY
)"
fi
if [[ "${MANGO_YTDLP_ALLOW_DURING_PLAYBACK:-0}" != "1" ]] \
  && command -v pgrep >/dev/null 2>&1 \
  && pgrep -x mpv >/dev/null 2>&1; then
  schedule_deferred_refresh || true
  echo "youtube runtime: candidate canary deferred while mpv is active"
  exit 75
fi

canary_args=(
  --yt-dlp "$STAGING/venv/bin/yt-dlp"
  --repo-root "$REPO_ROOT"
  --deno "$DENO_BIN"
)
set +e
python3 "$CANARY" "${canary_args[@]}" >"$STAGING/canary.json"
canary_rc=$?
set -e
canary_ok="$(python3 - "$STAGING/canary.json" <<'PY'
import json
import sys
try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
    print("1" if value.get("ok") is True and value.get("transport") is True else "0")
except Exception:
    print("0")
PY
)"
if [[ "$canary_rc" != "0" || "$canary_ok" != "1" ]]; then
  record_failed_canary "$STAGING/canary.json"
  if slot_canaried "$ACTIVE"; then
    active_canary="$STAGING/active-canary.json"
    set +e
    python3 "$CANARY" \
      --yt-dlp "$ACTIVE/venv/bin/yt-dlp" \
      --repo-root "$REPO_ROOT" \
      --deno "$DENO_BIN" >"$active_canary"
    active_rc=$?
    set -e
    active_ok="$(python3 - "$active_canary" <<'PY'
import json
import sys
try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
    print("1" if value.get("ok") is True and value.get("transport") is True else "0")
except Exception:
    print("0")
PY
)"
    if [[ "$active_rc" == "0" && "$active_ok" == "1" ]]; then
      python3 - "$ACTIVE/meta.json" "$active_canary" <<'PY'
import json
import os
import pathlib
import sys
import time

meta_path = pathlib.Path(sys.argv[1])
meta = json.load(open(meta_path, encoding="utf-8"))
meta["last_canary_at"] = int(time.time() * 1000)
meta["canary"] = "pass"
meta["canary_result"] = json.load(open(sys.argv[2], encoding="utf-8"))
tmp = meta_path.with_name(f".{meta_path.name}.tmp.{os.getpid()}")
tmp.write_text(json.dumps(meta, sort_keys=True) + "\n", encoding="utf-8")
os.replace(tmp, meta_path)
PY
      date +%s >"$STAMP"
      rm -f "$REQUEST"
      echo "youtube runtime: candidate=$revision failed canary; active runtime revalidated" >&2
      exit 0
    fi
  fi
  if slot_canaried "$PREVIOUS"; then
    previous_canary="$STAGING/previous-canary.json"
    previous_args=(
      --yt-dlp "$PREVIOUS/venv/bin/yt-dlp"
      --repo-root "$REPO_ROOT"
      --deno "$DENO_BIN"
    )
    set +e
    python3 "$CANARY" "${previous_args[@]}" >"$previous_canary"
    previous_rc=$?
    set -e
    previous_ok="$(python3 - "$previous_canary" <<'PY'
import json
import sys
try:
    value = json.load(open(sys.argv[1], encoding="utf-8"))
    print("1" if value.get("ok") is True and value.get("transport") is True else "0")
except Exception:
    print("0")
PY
)"
    if [[ "$previous_rc" == "0" && "$previous_ok" == "1" ]]; then
      old_active="$(real_path "$ACTIVE")"
      old_previous="$(real_path "$PREVIOUS")"
      atomic_symlink "$old_previous" "$ACTIVE"
      atomic_symlink "$old_active" "$PREVIOUS"
      python3 - "$ACTIVE/meta.json" "$previous_canary" <<'PY'
import json
import os
import pathlib
import sys
import time

meta_path = pathlib.Path(sys.argv[1])
meta = json.load(open(meta_path, encoding="utf-8"))
meta["rollback_at"] = int(time.time() * 1000)
meta["rollback_reason"] = "active_canary_failed"
meta["canary"] = "pass"
meta["canary_result"] = json.load(open(sys.argv[2], encoding="utf-8"))
tmp = meta_path.with_name(f".{meta_path.name}.tmp.{os.getpid()}")
tmp.write_text(json.dumps(meta, sort_keys=True) + "\n", encoding="utf-8")
os.replace(tmp, meta_path)
PY
      date +%s >"$STAMP"
      rm -f "$REQUEST"
      echo "youtube runtime: active canary failed; rolled back to previous canaried slot" >&2
      exit 0
    fi
  fi
  date +%s >"$STAMP"
  rm -f "$REQUEST"
  echo "youtube runtime: candidate=$revision failed canary; keeping current runtime" >&2
  if existing_runtime; then
    exit 0
  fi
  exit 1
fi

if [[ "$revision" == "$active_revision" && "$plugin_version" == "$active_plugin_version" ]] \
  && slot_canaried "$ACTIVE"; then
  python3 - "$ACTIVE/meta.json" "$STAGING/canary.json" <<'PY'
import json
import os
import pathlib
import sys
import time

meta_path = pathlib.Path(sys.argv[1])
meta = json.load(open(meta_path, encoding="utf-8"))
meta["last_canary_at"] = int(time.time() * 1000)
meta["canary"] = "pass"
meta["canary_result"] = json.load(open(sys.argv[2], encoding="utf-8"))
tmp = meta_path.with_name(f".{meta_path.name}.tmp.{os.getpid()}")
tmp.write_text(json.dumps(meta, sort_keys=True) + "\n", encoding="utf-8")
os.replace(tmp, meta_path)
PY
  date +%s >"$STAMP"
  rm -f "$REQUEST"
  echo "youtube runtime: active=$revision revalidated after runtime failure"
  exit 0
fi

python3 - "$STAGING/canary.json" "$STAGING/meta.json" "$revision" "$CHANNEL" "$plugin_version" <<'PY'
import json
import pathlib
import sys
import time

canary = json.load(open(sys.argv[1], encoding="utf-8"))
payload = {
    "revision": sys.argv[3],
    "channel": sys.argv[4],
    "promoted_at": int(time.time() * 1000),
    "ejs": True,
    "js_runtime": "deno",
    "pot_plugin_version": sys.argv[5],
    "canary": "pass",
    "canary_result": canary,
}
pathlib.Path(sys.argv[2]).write_text(
    json.dumps(payload, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

safe_revision="$(printf '%s' "$revision" | tr -cd 'A-Za-z0-9._-')"
[[ -n "$safe_revision" ]] || safe_revision="$(now_epoch)"
destination="$REVISIONS/${CHANNEL}-${safe_revision}"
if [[ -e "$destination" ]]; then
  destination="${destination}-$(now_epoch)-$$"
fi
mv "$STAGING" "$destination"
STAGING=""

old_active=""
if [[ -d "$ACTIVE" && ! -L "$ACTIVE" ]]; then
  adopted="$REVISIONS/adopted-$(now_epoch)"
  mv "$ACTIVE" "$adopted"
  old_active="$(real_path "$adopted")"
fi
if [[ -x "$ACTIVE/venv/bin/yt-dlp" ]]; then
  old_active="$(real_path "$ACTIVE")"
fi
if [[ -n "$old_active" && "$old_active" != "$(real_path "$destination")" ]]; then
  atomic_symlink "$old_active" "$PREVIOUS"
fi
atomic_symlink "$destination" "$ACTIVE"

python3 - "$REVISIONS" "$ACTIVE" "$PREVIOUS" <<'PY'
import os
import pathlib
import shutil
import sys

root = pathlib.Path(sys.argv[1])
keep = {
    os.path.realpath(path)
    for path in sys.argv[2:]
    if os.path.exists(path)
}
for child in root.iterdir():
    if child.is_dir() and os.path.realpath(child) not in keep:
        shutil.rmtree(child)
PY

date +%s >"$STAMP"
rm -f "$REQUEST"
echo "youtube runtime: promoted=$revision channel=$CHANNEL previous=$([[ -n "$old_active" ]] && echo yes || echo no)"

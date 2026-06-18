#!/usr/bin/env bash
# Capture a JSON baseline for N0 process, memory, and listener gates.

set -euo pipefail

LABEL="baseline"
OUTPUT=""
PRINT_JSON=0
PATH_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label)
      LABEL="${2:?missing label}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:?missing output path}"
      shift 2
      ;;
    --print-json)
      PRINT_JSON=1
      shift
      ;;
    --path-only)
      PATH_ONLY=1
      shift
      ;;
    -h | --help)
      echo "usage: $0 [--label LABEL] [--output PATH] [--print-json] [--path-only]"
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$OUTPUT" ]]; then
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  OUT_DIR="${MANGO_BASELINE_DIR:-$HOME/.cache/mango/diag/baselines}"
  mkdir -p "$OUT_DIR"
  OUTPUT="$OUT_DIR/${LABEL}-${TS}.json"
else
  mkdir -p "$(dirname "$OUTPUT")"
fi

python3 - "$LABEL" "$OUTPUT" <<'PY'
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

label = sys.argv[1]
output = Path(sys.argv[2])


def run(args: list[str]) -> str:
    try:
        return subprocess.run(args, text=True, capture_output=True, check=False).stdout
    except OSError:
        return ""


def run_shell(command: str) -> str:
    try:
        return subprocess.run(
            ["bash", "-lc", command], text=True, capture_output=True, check=False
        ).stdout
    except OSError:
        return ""


def git_sha() -> str:
    return run(["git", "rev-parse", "--short", "HEAD"]).strip() or "unknown"


def parse_processes() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in run(["ps", "-eo", "pid=,rss=,comm=,args="]).splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        pid, rss, comm, args = parts
        try:
            rows.append(
                {
                    "pid": int(pid),
                    "rss_kb": int(rss),
                    "comm": comm,
                    "args": args,
                }
            )
        except ValueError:
            continue
    return rows


processes = parse_processes()


def matching(pattern: str) -> list[dict[str, object]]:
    regex = re.compile(pattern, re.IGNORECASE)
    return [proc for proc in processes if regex.search(str(proc["args"]))]


def rss_mb(rows: list[dict[str, object]]) -> int:
    return round(sum(int(row["rss_kb"]) for row in rows) / 1024)


chromium_all = matching(r"chromium")
chromium_apps = [
    proc
    for proc in chromium_all
    if " --type=" not in str(proc["args"]) and " --app=" in str(proc["args"])
]
overlay = matching(r"chromium.*mango-overlay")
stremio = matching(r"stremio")
kodi = matching(r"\bkodi\b")
mpv = matching(r"\bmpv\b")
orchestrator = matching(r"orchestrator\.main")
serve = matching(r"mango-ui-server/serve\.py|src/mango-ui-server/serve\.py")
node = [proc for proc in processes if str(proc["comm"]) == "node" or " node " in str(proc["args"])]

free_m = run(["free", "-m"])
mem_available_mb = None
for line in free_m.splitlines():
    if line.startswith("Mem:"):
        parts = line.split()
        if len(parts) >= 7:
            try:
                mem_available_mb = int(parts[6])
            except ValueError:
                pass

listeners = [
    line.strip()
    for line in run_shell("ss -tlnp 2>/dev/null | grep -E '3000|3001|8765|8766|8080' || true").splitlines()
    if line.strip()
]

payload = {
    "label": label,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "hostname": socket.gethostname(),
    "git_sha": git_sha(),
    "memory": {
        "free_m": free_m,
        "mem_available_mb": mem_available_mb,
    },
    "process_counts": {
        "chromium_process_count": len(chromium_apps),
        "chromium_total_process_count": len(chromium_all),
        "overlay_chromium": len(overlay),
        "stremio_process_count": len(stremio),
        "kodi_process_count": len(kodi),
        "mpv_process_count": len(mpv),
        "orchestrator_process_count": len(orchestrator),
        "serve_process_count": len(serve),
        "node_process_count": len(node),
    },
    "rss_mb": {
        "chromium_total": rss_mb(chromium_all),
        "chromium_apps": rss_mb(chromium_apps),
        "overlay_chromium": rss_mb(overlay),
        "stremio": rss_mb(stremio),
        "kodi": rss_mb(kodi),
        "mpv": rss_mb(mpv),
        "orchestrator": rss_mb(orchestrator),
        "serve": rss_mb(serve),
        "node": rss_mb(node),
    },
    "listeners": listeners,
}

output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
latest = output.parent / f"{label}-latest.json"
try:
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(output.name)
except OSError:
    latest.write_text(output.read_text(encoding="utf-8"), encoding="utf-8")
PY

if [[ "$PATH_ONLY" == "1" ]]; then
  echo "$OUTPUT"
  exit 0
fi
if [[ "$PRINT_JSON" == "1" ]]; then
  cat "$OUTPUT"
else
  echo "wrote $OUTPUT"
fi

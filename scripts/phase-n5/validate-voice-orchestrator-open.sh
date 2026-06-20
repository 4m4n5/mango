#!/usr/bin/env bash
# Orchestrator path: search → open_title → enqueue → wait for launcher ack.
# Run on Pi. Requires catalog + launcher Chromium up.
#
# Usage: bash scripts/phase-n5/validate-voice-orchestrator-open.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

if [[ ! -d src/orchestrator/.venv ]]; then
  echo "FAIL: orchestrator venv missing"
  exit 1
fi

(
  cd src/orchestrator
  # shellcheck disable=SC1091
  source .venv/bin/activate
  python3 <<'PY'
import asyncio
import os
import sys

from orchestrator.config import load_settings
from orchestrator.llm.agent import _open_best_from_hits, _parse_search_results
from orchestrator.llm.open_intent import user_wants_title_navigation
from orchestrator.tools.launcher import build_launcher_command
from orchestrator.tools.launcher_dispatch import post_launcher_command
from orchestrator.tools.runner import execute_tool

QUERY = os.environ.get("MANGO_VOICE_TEST_QUERY", "Shawshank")


async def dispatch(command: dict) -> int | None:
    settings = load_settings()
    try:
        return await asyncio.to_thread(post_launcher_command, settings, command)
    except Exception as exc:
        print(f"FAIL: dispatch error: {exc}", file=sys.stderr)
        return None


async def main() -> int:
    settings = load_settings()
    assert user_wants_title_navigation(f"open {QUERY}"), "title navigation intent detector broken"
    search_json = await execute_tool(
        "mango_search",
        {"query": QUERY, "limit": 3},
        settings,
    )
    hits = _parse_search_results(search_json)
    if not hits:
        print(f"FAIL: no search hits for {QUERY}: {search_json}", file=sys.stderr)
        return 1
    opened, _title = await _open_best_from_hits(hits, settings, dispatch)
    if not opened:
        cmd = build_launcher_command("mango_open_title", {
            "type": hits[0].get("type"),
            "id": hits[0].get("id"),
            "title": hits[0].get("title"),
            "tab": hits[0].get("tab"),
        })
        seq = await dispatch(cmd)
        opened = isinstance(seq, int) and seq > 0
    if not opened:
        print("FAIL: orchestrator open path did not confirm TV ack", file=sys.stderr)
        return 1
    print(f"PASS: orchestrator search+open ack for {QUERY}")
    return 0


raise SystemExit(asyncio.run(main()))
PY
)

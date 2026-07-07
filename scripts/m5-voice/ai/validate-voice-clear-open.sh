#!/usr/bin/env bash
# Clear open path: search → explicit hit → launcher ack (no fast-path bypass).
# Usage: bash scripts/m5-voice/ai/validate-voice-clear-open.sh

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../../.." && pwd)}"
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
from orchestrator.llm.agent import _open_hit, _parse_search_results
from orchestrator.llm.open_intent import user_wants_open_detail
from orchestrator.tools.launcher_dispatch import post_launcher_command
from orchestrator.tools.runner import execute_tool
from orchestrator.tools.voice_nav import pick_auto_open_hit

QUERY = os.environ.get("MANGO_VOICE_TEST_QUERY", "")
CATALOG_URL = os.environ.get("MANGO_CATALOG_UPSTREAM", "http://127.0.0.1:3020")


def _pick_verified_movie_title() -> str:
    # Pick a verified library movie from the served rails — robust to any one
    # title being invalidated by upstream debrid flakiness (the gate tests the
    # search→open path, not a specific title).
    import json
    import urllib.request

    with urllib.request.urlopen(f"{CATALOG_URL}/rails/items?tab=movies", timeout=10) as resp:
        data = json.load(resp)
    for rail in data.get("rails", []):
        for item in rail.get("items") or []:
            if item.get("type") == "movie" and item.get("title"):
                return item["title"]
    raise SystemExit("FAIL: no verified movie titles in served rails")


if not QUERY:
    QUERY = _pick_verified_movie_title()


async def dispatch(command: dict) -> int | None:
    settings = load_settings()
    try:
        return await asyncio.to_thread(post_launcher_command, settings, command)
    except Exception as exc:
        print(f"FAIL: dispatch error: {exc}", file=sys.stderr)
        return None


async def main() -> int:
    utterance = f"open {QUERY}"
    if not user_wants_open_detail(utterance):
        print(f"FAIL: clear open utterance not detected: {utterance!r}", file=sys.stderr)
        return 1

    settings = load_settings()
    search_json = await execute_tool(
        "mango_search",
        {"query": QUERY, "limit": 5},
        settings,
    )
    hits = _parse_search_results(search_json)
    if not hits:
        print(f"FAIL: no search hits for {QUERY}", file=sys.stderr)
        return 1

    hit = pick_auto_open_hit(hits, query=QUERY)
    if hit is None:
        hit = hits[0]

    opened, _title = await _open_hit(hit, settings, dispatch)
    if not opened:
        print("FAIL: clear open path did not confirm TV ack", file=sys.stderr)
        return 1

    print(f"PASS: clear open search+_open_hit ack for {QUERY}")
    return 0


raise SystemExit(asyncio.run(main()))
PY
)

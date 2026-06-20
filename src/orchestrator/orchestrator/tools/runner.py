"""Execute mango voice tools (catalog HTTP + launcher websocket dispatch)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

from orchestrator.config import OrchestratorSettings
from orchestrator.tools import catalog as catalog_tools
from orchestrator.tools.launcher import (
    LauncherCommandError,
    build_launcher_command,
    summarize_launcher_command,
)

LauncherDispatch = Callable[[dict[str, Any]], Awaitable[None]]


def _compact(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


async def execute_tool(
    name: str,
    tool_input: dict[str, Any],
    settings: OrchestratorSettings,
    *,
    dispatch_launcher: LauncherDispatch | None = None,
) -> str:
    if name == "mango_search":
        query = tool_input.get("query")
        if not isinstance(query, str) or not query.strip():
            return _compact({"ok": False, "error": "query required"})
        limit = tool_input.get("limit", 5)
        limit_value = int(limit) if isinstance(limit, (int, float)) else 5
        return _compact(
            await asyncio.to_thread(
                catalog_tools.tool_search,
                settings,
                query.strip(),
                limit_value,
            )
        )

    if name in {"mango_play", "mango_play_continue"}:
        return _compact({
            "ok": False,
            "error": "voice cannot start playback — use mango_open_title after search",
        })

    if name == "mango_now_playing":
        return _compact(await asyncio.to_thread(catalog_tools.tool_now_playing, settings))

    if name == "mango_library_shuffle":
        return _compact(await asyncio.to_thread(catalog_tools.tool_library_shuffle, settings))

    if name == "mango_playability_refresh":
        level = tool_input.get("level")
        if not isinstance(level, str):
            return _compact({"ok": False, "error": "level required"})
        confirmed = bool(tool_input.get("confirmed"))
        return _compact(
            await asyncio.to_thread(
                catalog_tools.tool_playability_refresh,
                settings,
                level=level,
                confirmed=confirmed,
            )
        )

    if name in {"mango_navigate", "mango_open_title"}:
        try:
            command = build_launcher_command(name, tool_input)
        except LauncherCommandError as exc:
            return _compact({"ok": False, "error": str(exc)})
        if dispatch_launcher is not None:
            await dispatch_launcher(command)
        return _compact({"ok": True, "summary": summarize_launcher_command(command)})

    return _compact({"ok": False, "error": f"unknown tool: {name}"})


def tool_summary(name: str, tool_input: dict[str, Any]) -> str:
    if name == "mango_search":
        return f"Searching for {tool_input.get('query', '…')}"
    if name == "mango_open_title":
        return f"Opening {tool_input.get('title', 'title')}"
    if name == "mango_now_playing":
        return "Checking now playing"
    if name == "mango_library_shuffle":
        return "Shuffling home rails"
    if name == "mango_playability_refresh":
        return f"Library refresh ({tool_input.get('level', 'job')})"
    if name in {"mango_navigate", "mango_open_title"}:
        try:
            command = build_launcher_command(name, tool_input)
            return summarize_launcher_command(command)
        except LauncherCommandError:
            return "Navigating TV"
    return name

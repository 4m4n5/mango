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

    if name == "mango_play":
        content_type = tool_input.get("type")
        content_id = tool_input.get("id")
        if not isinstance(content_type, str) or not isinstance(content_id, str):
            return _compact({"ok": False, "error": "type and id required"})
        resume = bool(tool_input.get("resume"))
        result = await asyncio.to_thread(
            catalog_tools.tool_play,
            settings,
            content_type=content_type,
            content_id=content_id,
            resume=resume,
        )
        return _compact(result)

    if name == "mango_play_continue":
        tab = tool_input.get("tab")
        tab_value = tab if isinstance(tab, str) else None
        target = await asyncio.to_thread(
            catalog_tools.tool_continue_target,
            settings,
            tab_value,
        )
        if not target.get("found"):
            return _compact(target)
        play_result = await asyncio.to_thread(
            catalog_tools.tool_play,
            settings,
            content_type=str(target["type"]),
            content_id=str(target["id"]),
            resume=True,
        )
        return _compact({"continue": target, "play": play_result})

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

    if name == "mango_navigate":
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
    if name == "mango_play":
        return f"Starting playback ({tool_input.get('type')} {tool_input.get('id')})"
    if name == "mango_play_continue":
        return "Resuming continue watching"
    if name == "mango_now_playing":
        return "Checking now playing"
    if name == "mango_library_shuffle":
        return "Shuffling home rails"
    if name == "mango_playability_refresh":
        return f"Library refresh ({tool_input.get('level', 'job')})"
    if name == "mango_navigate":
        try:
            command = build_launcher_command(name, tool_input)
            return summarize_launcher_command(command)
        except LauncherCommandError:
            return "Navigating TV"
    return name

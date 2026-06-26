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

LauncherDispatch = Callable[[dict[str, Any]], Awaitable[int | None]]


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

    if name == "mango_library_overview":
        return _compact(await asyncio.to_thread(catalog_tools.tool_library_overview, settings))

    if name == "mango_library_browse":
        limit = tool_input.get("limit", 120)
        limit_value = int(limit) if isinstance(limit, (int, float)) else 120
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_library_browse, settings, limit_value)
        )

    if name == "mango_search_external":
        query = tool_input.get("query")
        if not isinstance(query, str) or not query.strip():
            return _compact({"ok": False, "error": "query required"})
        content_type = tool_input.get("type")
        type_value = content_type if isinstance(content_type, str) else None
        limit = tool_input.get("limit", 8)
        limit_value = int(limit) if isinstance(limit, (int, float)) else 8
        queue_missing = bool(tool_input.get("queue_missing"))
        return _compact(
            await asyncio.to_thread(
                catalog_tools.tool_search_external,
                settings,
                query.strip(),
                content_type=type_value,
                limit=limit_value,
                queue_missing=queue_missing,
            )
        )

    if name == "mango_read_librarian_notes":
        return _compact(await asyncio.to_thread(catalog_tools.tool_read_librarian_notes, settings))

    if name == "mango_update_librarian_notes":
        notes = tool_input.get("notes")
        if not isinstance(notes, str):
            return _compact({"ok": False, "error": "notes required"})
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_update_librarian_notes, settings, notes)
        )

    if name == "mango_read_profile":
        return _compact(await asyncio.to_thread(catalog_tools.tool_read_profile, settings))

    if name == "mango_companion_summary":
        return _compact(await asyncio.to_thread(catalog_tools.tool_companion_summary, settings))

    if name == "mango_patch_profile":
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_patch_profile, settings, dict(tool_input))
        )

    if name == "mango_append_session_notes":
        bullets = tool_input.get("bullets")
        if not isinstance(bullets, list):
            return _compact({"ok": False, "error": "bullets required"})
        bullet_text = [str(item).strip() for item in bullets if str(item).strip()]
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_append_session_notes, settings, bullet_text)
        )

    if name in {"mango_play", "mango_play_continue", "play_youtube", "mango_play_youtube"}:
        return _compact({
            "ok": False,
            "error": "voice cannot start playback — open the detail/result and use pad B",
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

    if name == "mango_list_ai_catalogs":
        return _compact(await asyncio.to_thread(catalog_tools.tool_list_ai_catalogs, settings))

    if name == "mango_create_ai_catalog":
        label = tool_input.get("label")
        tab = tool_input.get("tab")
        content_type = tool_input.get("content_type")
        if not isinstance(label, str) or not label.strip():
            return _compact({"ok": False, "error": "label required"})
        if tab not in {"movies", "series"}:
            return _compact({"ok": False, "error": "tab must be movies or series"})
        if content_type not in {"movie", "series"}:
            return _compact({"ok": False, "error": "content_type must be movie or series"})
        body = dict(tool_input)
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_create_ai_catalog, settings, body)
        )

    if name == "mango_update_ai_catalog":
        slot_id = tool_input.get("slot_id")
        if not isinstance(slot_id, str) or not slot_id.strip():
            return _compact({"ok": False, "error": "slot_id required"})
        body = dict(tool_input)
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_update_ai_catalog, settings, body)
        )

    if name == "mango_delete_ai_catalog":
        slot_id = tool_input.get("slot_id")
        if not isinstance(slot_id, str) or not slot_id.strip():
            return _compact({"ok": False, "error": "slot_id required"})
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_delete_ai_catalog, settings, slot_id.strip())
        )

    if name == "mango_refresh_ai_catalog":
        slot_id = tool_input.get("slot_id")
        if not isinstance(slot_id, str) or not slot_id.strip():
            return _compact({"ok": False, "error": "slot_id required"})
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_refresh_ai_catalog, settings, slot_id.strip())
        )

    if name == "mango_ai_catalog_status":
        slot_id = tool_input.get("slot_id")
        if not isinstance(slot_id, str) or not slot_id.strip():
            return _compact({"ok": False, "error": "slot_id required"})
        return _compact(
            await asyncio.to_thread(catalog_tools.tool_ai_catalog_status, settings, slot_id.strip())
        )

    if name in {"mango_navigate", "mango_open_title"}:
        try:
            command = build_launcher_command(name, tool_input)
        except LauncherCommandError as exc:
            return _compact({"ok": False, "error": str(exc)})
        tv_seq: int | None = None
        if dispatch_launcher is not None:
            tv_seq = await dispatch_launcher(command)
        if tv_seq is None and name == "mango_open_title":
            from orchestrator.tools.launcher_dispatch import post_launcher_command

            try:
                tv_seq = await asyncio.to_thread(post_launcher_command, settings, command)
            except Exception as exc:
                return _compact({
                    "ok": False,
                    "error": str(exc),
                    "summary": summarize_launcher_command(command),
                })
        if tv_seq is None:
            return _compact({
                "ok": False,
                "error": "TV did not receive navigation command",
                "summary": summarize_launcher_command(command),
            })
        return _compact({
            "ok": True,
            "tv_seq": tv_seq,
            "summary": summarize_launcher_command(command),
        })

    return _compact({"ok": False, "error": f"unknown tool: {name}"})


def tool_summary(name: str, tool_input: dict[str, Any]) -> str:
    if name == "mango_search":
        return f"Searching library for {tool_input.get('query', '…')}"
    if name == "mango_library_overview":
        return "Reading library overview"
    if name == "mango_library_browse":
        return "Browsing verified library"
    if name == "mango_search_external":
        return f"Searching outside library for {tool_input.get('query', '…')}"
    if name == "mango_read_librarian_notes":
        return "Reading librarian notes"
    if name == "mango_update_librarian_notes":
        return "Updating librarian notes"
    if name == "mango_read_profile":
        return "Reading companion profile"
    if name == "mango_patch_profile":
        return "Updating companion profile"
    if name == "mango_companion_summary":
        return "Summarizing what I know about you"
    if name == "mango_append_session_notes":
        return "Saving session notes"
    if name == "mango_open_title":
        return f"Opening {tool_input.get('title', 'title')}"
    if name == "mango_now_playing":
        return "Checking now playing"
    if name == "mango_library_shuffle":
        return "Shuffling home rails"
    if name == "mango_playability_refresh":
        return f"Library refresh ({tool_input.get('level', 'job')})"
    if name == "mango_list_ai_catalogs":
        return "Listing AI catalog rails"
    if name == "mango_create_ai_catalog":
        return f"Creating AI catalog {tool_input.get('label', '…')}"
    if name == "mango_update_ai_catalog":
        return f"Updating AI catalog {tool_input.get('slot_id', '…')}"
    if name == "mango_delete_ai_catalog":
        return f"Deleting AI catalog {tool_input.get('slot_id', '…')}"
    if name == "mango_refresh_ai_catalog":
        return f"Refreshing AI catalog pool {tool_input.get('slot_id', '…')}"
    if name == "mango_ai_catalog_status":
        return f"Checking AI catalog {tool_input.get('slot_id', '…')}"
    if name in {"mango_navigate", "mango_open_title"}:
        try:
            command = build_launcher_command(name, tool_input)
            return summarize_launcher_command(command)
        except LauncherCommandError:
            return "Navigating TV"
    return name

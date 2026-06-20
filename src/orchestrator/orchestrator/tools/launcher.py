"""Launcher-side voice commands — dispatched over the orchestrator websocket."""

from __future__ import annotations

from typing import Any


class LauncherCommandError(RuntimeError):
    pass


def build_launcher_command(name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    if name == "mango_open_title":
        return _open_title_command(tool_input)

    if name != "mango_navigate":
        raise LauncherCommandError(f"unknown launcher tool: {name}")

    action = tool_input.get("action")
    if not isinstance(action, str) or not action.strip():
        raise LauncherCommandError("mango_navigate requires action")

    payload: dict[str, Any] = {
        "type": "launcher_command",
        "action": action.strip(),
    }

    if action == "tab":
        tab = tool_input.get("tab")
        if not isinstance(tab, str):
            raise LauncherCommandError("mango_navigate tab requires tab")
        payload["tab"] = tab
    elif action not in {"home", "back", "settings"}:
        raise LauncherCommandError(f"unsupported navigate action: {action}")

    return payload


def _open_title_command(tool_input: dict[str, Any]) -> dict[str, Any]:
    content_type = tool_input.get("type")
    content_id = tool_input.get("id")
    title = tool_input.get("title")
    if not isinstance(content_type, str) or not isinstance(content_id, str):
        raise LauncherCommandError("open_title requires type and id")
    if not isinstance(title, str) or not title.strip():
        raise LauncherCommandError("open_title requires title")

    payload: dict[str, Any] = {
        "type": "launcher_command",
        "action": "open_detail",
        "content_type": content_type,
        "id": content_id,
        "title": title.strip(),
    }
    tab = tool_input.get("tab")
    if isinstance(tab, str) and tab.strip():
        payload["tab"] = tab.strip()
    poster = tool_input.get("poster")
    if isinstance(poster, str) and poster.strip():
        payload["poster"] = poster.strip()
    return payload


def summarize_launcher_command(command: dict[str, Any]) -> str:
    action = command.get("action")
    if action == "home":
        return "Opened home"
    if action == "back":
        return "Went back"
    if action == "settings":
        return "Opened settings"
    if action == "tab":
        return f"Switched to {command.get('tab', 'tab')}"
    if action == "open_detail":
        title = command.get("title") or command.get("id") or "title"
        return f"Opened {title} — press B to play"
    return "Navigation updated"

"""HTTP client for catalog-service voice/media tools."""

from __future__ import annotations

import json
from typing import Any

import httpx

from orchestrator.config import OrchestratorSettings


class CatalogToolError(RuntimeError):
    pass


def _base_url(settings: OrchestratorSettings) -> str:
    return settings.catalog_upstream.rstrip("/")


def fetch_tool_manifest(settings: OrchestratorSettings) -> dict[str, Any]:
    with httpx.Client(timeout=10.0) as client:
        response = client.get(f"{_base_url(settings)}/voice/tools")
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise CatalogToolError("invalid voice tools manifest")
    return payload


def catalog_tools_for_llm(settings: OrchestratorSettings) -> list[dict[str, Any]]:
    manifest = fetch_tool_manifest(settings)
    tools = manifest.get("tools")
    if not isinstance(tools, list):
        raise CatalogToolError("voice tools manifest missing tools[]")
    llm_tools: list[dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict) or tool.get("layer") != "catalog":
            continue
        name = tool.get("name")
        description = tool.get("description")
        input_schema = tool.get("input_schema")
        if not isinstance(name, str) or not isinstance(description, str):
            continue
        if not isinstance(input_schema, dict):
            continue
        llm_tools.append(
            {"name": name, "description": description, "input_schema": input_schema}
        )
    return llm_tools


def launcher_tool_names(settings: OrchestratorSettings) -> set[str]:
    manifest = fetch_tool_manifest(settings)
    tools = manifest.get("tools")
    if not isinstance(tools, list):
        return set()
    names: set[str] = set()
    for tool in tools:
        if isinstance(tool, dict) and tool.get("layer") == "launcher":
            name = tool.get("name")
            if isinstance(name, str):
                names.add(name)
    return names


def _request_json(
    settings: OrchestratorSettings,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
    timeout: float = 120.0,
) -> dict[str, Any]:
    url = f"{_base_url(settings)}{path}"
    with httpx.Client(timeout=timeout) as client:
        response = client.request(method, url, params=params, json=body)
    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise CatalogToolError(f"catalog returned non-json ({response.status_code})") from exc
    if response.status_code >= 400:
        error = payload.get("error") if isinstance(payload, dict) else None
        message = error if isinstance(error, str) else f"catalog error {response.status_code}"
        raise CatalogToolError(message)
    if not isinstance(payload, dict):
        raise CatalogToolError("catalog returned unexpected payload")
    return payload


def tool_search(settings: OrchestratorSettings, query: str, limit: int = 5) -> dict[str, Any]:
    return _request_json(
        settings,
        "GET",
        "/voice/search",
        params={"q": query, "limit": max(1, min(limit, 12))},
        timeout=15.0,
    )


def tool_library_overview(settings: OrchestratorSettings) -> dict[str, Any]:
    return _request_json(
        settings,
        "GET",
        "/voice/library",
        params={"overview": "1"},
        timeout=20.0,
    )


def tool_library_browse(settings: OrchestratorSettings, limit: int = 120) -> dict[str, Any]:
    return _request_json(
        settings,
        "GET",
        "/voice/library",
        params={"limit": max(1, min(limit, 500))},
        timeout=30.0,
    )


def tool_search_external(
    settings: OrchestratorSettings,
    query: str,
    *,
    content_type: str | None = None,
    limit: int = 8,
    queue_missing: bool = False,
) -> dict[str, Any]:
    params: dict[str, Any] = {
        "q": query,
        "limit": max(1, min(limit, 12)),
    }
    if content_type in {"movie", "series"}:
        params["type"] = content_type
    if queue_missing:
        params["queue"] = "1"
    return _request_json(
        settings,
        "GET",
        "/voice/search-external",
        params=params,
        timeout=30.0,
    )


def tool_read_librarian_notes(settings: OrchestratorSettings) -> dict[str, Any]:
    return _request_json(settings, "GET", "/voice/library/notes", timeout=10.0)


def tool_update_librarian_notes(settings: OrchestratorSettings, notes: str) -> dict[str, Any]:
    return _request_json(
        settings,
        "POST",
        "/voice/library/notes",
        body={"notes": notes},
        timeout=10.0,
    )


def tool_now_playing(settings: OrchestratorSettings) -> dict[str, Any]:
    return _request_json(settings, "GET", "/voice/now-playing", timeout=10.0)


def tool_continue_target(settings: OrchestratorSettings, tab: str | None = None) -> dict[str, Any]:
    params = {"tab": tab} if tab else None
    return _request_json(settings, "GET", "/voice/continue", params=params, timeout=10.0)


def tool_play(
    settings: OrchestratorSettings,
    *,
    content_type: str,
    content_id: str,
    resume: bool = False,
) -> dict[str, Any]:
    body: dict[str, Any] = {"type": content_type, "id": content_id}
    if resume:
        body["resume"] = True
    return _request_json(settings, "POST", "/play", body=body, timeout=120.0)


def tool_library_shuffle(settings: OrchestratorSettings) -> dict[str, Any]:
    return _request_json(
        settings,
        "POST",
        "/playability/refresh",
        body={"level": "shuffle_rails"},
        timeout=30.0,
    )


def tool_playability_refresh(
    settings: OrchestratorSettings,
    *,
    level: str,
    confirmed: bool = False,
) -> dict[str, Any]:
    manifest = fetch_tool_manifest(settings)
    tools = manifest.get("tools")
    requires_confirm = False
    if isinstance(tools, list):
        for tool in tools:
            if isinstance(tool, dict) and tool.get("name") == "mango_playability_refresh":
                requires_confirm = bool(tool.get("requires_confirm"))
                break
    if requires_confirm and not confirmed:
        return {
            "ok": False,
            "needs_confirm": True,
            "message": "This refresh pauses couch browsing. Ask the user to confirm, then retry with confirmed=true.",
            "level": level,
        }
    return _request_json(
        settings,
        "POST",
        "/playability/refresh",
        body={"level": level},
        timeout=30.0,
    )

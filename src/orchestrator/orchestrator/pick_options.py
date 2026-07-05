"""Structured search picks for companion phone UI."""

from __future__ import annotations

import json
from typing import Any

SEARCH_TOOLS = frozenset(
    {
        "mango_search",
        "mango_youtube_search",
        "mango_search_external",
    }
)


def parse_search_hits(result: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(result)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return []
    results = payload.get("results")
    if not isinstance(results, list):
        return []
    hits: list[dict[str, Any]] = []
    for item in results:
        if isinstance(item, dict):
            hits.append(item)
    return hits


def pick_options_from_result(result: str) -> list[dict[str, Any]]:
    """Compact numbered options for companion when 2–4 ambiguous search hits."""
    options: list[dict[str, Any]] = []
    for index, hit in enumerate(parse_search_hits(result)[:4], start=1):
        title = hit.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        option: dict[str, Any] = {"n": index, "title": title.strip()}
        content_type = hit.get("type")
        if isinstance(content_type, str) and content_type.strip():
            option["type"] = content_type.strip()
        tab = hit.get("tab")
        if isinstance(tab, str) and tab.strip():
            option["tab"] = tab.strip()
        year = hit.get("year")
        if isinstance(year, str) and year.strip():
            option["year"] = year.strip()
        options.append(option)
    return options


def open_tool_for_hit(hit: dict[str, Any]) -> str:
    content_type = hit.get("type")
    if isinstance(content_type, str) and content_type.startswith("youtube_"):
        return "mango_open_youtube"
    return "mango_open_title"


def pick_hit_at_index(hits: list[dict[str, Any]], n: int) -> dict[str, Any] | None:
    if n < 1 or n > len(hits):
        return None
    return hits[n - 1]


def tool_result_open_confirmed(result: str) -> bool:
    try:
        payload = json.loads(result)
    except json.JSONDecodeError:
        return False
    return (
        isinstance(payload, dict)
        and payload.get("ok") is True
        and payload.get("tv_seq") is not None
    )


def enrich_tool_event(event: dict[str, Any]) -> dict[str, Any]:
    if event.get("phase") != "done":
        return event
    name = event.get("name")
    if name not in SEARCH_TOOLS:
        return event
    result = event.get("result")
    if not isinstance(result, str):
        return event
    options = pick_options_from_result(result)
    if len(options) < 2 or len(options) > 4:
        return event
    enriched = dict(event)
    enriched["options"] = options
    return enriched

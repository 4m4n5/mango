"""Tool-calling voice agent — Anthropic tools API + catalog/launcher dispatch."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any

from orchestrator.config import OrchestratorSettings
from orchestrator.llm.open_intent import user_wants_open_detail
from orchestrator.llm.provider import DeltaCallback, _clean_reply, _read_api_key
from orchestrator.tools import catalog as catalog_tools
from orchestrator.tools.runner import execute_tool, tool_summary

SYSTEM_PROMPT = (
    "You are mango's TV librarian — warm, knowledgeable couch assistant for a mango TV box. "
    "Users speak Hinglish, Hindi, or English — reply in the same mix (Roman script is fine). "
    "You know the verified playable library via tools; use world knowledge about films and shows too. "
    "For recommendations: mango_read_librarian_notes, then mango_library_overview or mango_library_browse. "
    "Suggest verified titles when possible; explain themes and why something fits. "
    "OPEN FLOW (specific title to watch now): mango_search → if match, mango_open_title with type,id,title,tab,poster. "
    "If not in library: mango_search_external with queue_missing=false → list 2–4 options on phone → "
    "only mango_open_title after the user picks one. "
    "QUEUE FLOW (add to library for later, no TV change): mango_search_external with queue_missing=true only when "
    "the user wants it saved for a future pool update — never open detail in the same turn as queue-only. "
    "After useful recommendation sessions, save concise taste/themes in mango_update_librarian_notes. "
    "NEVER start, pause, or resume playback — user presses B on the remote. "
    "CRITICAL: only say you opened a title if mango_open_title returned ok:true with tv_seq. "
    "If tv_seq is missing or ok:false, say the TV did not update and offer to retry. "
    "If search returns multiple close matches, ask one short clarifying question. "
    "For library refresh jobs that pause browsing, ask phone confirmation before confirmed=true. "
    "On failure, explain plainly — no fake success. "
    "Keep replies to one or two short sentences unless listing options."
)

LauncherDispatch = Callable[[dict[str, Any]], Awaitable[int | None]]
ToolEventCallback = Callable[[dict[str, Any]], Awaitable[None]]


def voice_tools_enabled(settings: OrchestratorSettings) -> bool:
    if os.environ.get("MANGO_VOICE_TOOLS") == "0":
        return False
    if os.environ.get("MANGO_VOICE_TOOLS") == "1":
        return True
    return settings.voice_tools_enabled


async def generate_agent_reply(
    messages: list[dict[str, str]],
    settings: OrchestratorSettings,
    *,
    on_delta: DeltaCallback | None = None,
    dispatch_launcher: LauncherDispatch | None = None,
    on_tool_event: ToolEventCallback | None = None,
) -> str:
    if os.environ.get("MANGO_LLM_MOCK") == "1":
        return _mock_reply(messages, on_delta=on_delta)

    if settings.llm_provider.lower() != "anthropic":
        raise RuntimeError("voice tools require llm.provider anthropic in config")

    api_key = _read_api_key(settings, "anthropic")
    tools = _load_tools(settings)
    if not tools:
        raise RuntimeError("no catalog voice tools available")

    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    transcript = messages
    open_confirmed = False
    last_search_hits: list[dict[str, Any]] = []
    user_open_intent = user_wants_open_detail(_last_user_text(messages))
    for _round in range(max(1, settings.max_tool_rounds)):
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=settings.llm_max_tokens,
            system=SYSTEM_PROMPT,
            messages=transcript,
            tools=tools,
        )

        tool_uses: list[Any] = []
        text_parts: list[str] = []
        for block in response.content:
            block_type = getattr(block, "type", None)
            if block_type == "tool_use":
                tool_uses.append(block)
            elif block_type == "text":
                text = getattr(block, "text", "")
                if isinstance(text, str) and text.strip():
                    text_parts.append(text)

        if response.stop_reason != "tool_use" or not tool_uses:
            if (
                user_open_intent
                and not open_confirmed
                and last_search_hits
                and dispatch_launcher is not None
            ):
                open_confirmed = await _auto_open_best_hit(
                    last_search_hits,
                    settings,
                    dispatch_launcher,
                    on_tool_event=on_tool_event,
                )
            reply = _clean_reply(" ".join(text_parts))
            if open_confirmed and user_open_intent and not reply.strip():
                reply = _default_open_reply(last_search_hits)
            reply = _guard_open_claims(reply, open_confirmed)
            if on_delta is not None:
                on_delta(reply)
            return reply

        assistant_content = [_serialize_block(block) for block in response.content]
        transcript = [
            *transcript,
            {"role": "assistant", "content": assistant_content},
        ]

        tool_result_blocks: list[dict[str, Any]] = []
        for tool_use in tool_uses:
            name = getattr(tool_use, "name", "")
            tool_id = getattr(tool_use, "id", "")
            tool_input = getattr(tool_use, "input", {})
            if not isinstance(name, str) or not isinstance(tool_id, str):
                continue
            if not isinstance(tool_input, dict):
                tool_input = {}

            summary = tool_summary(name, tool_input)
            if on_tool_event is not None:
                await on_tool_event(
                    {"type": "tool", "phase": "start", "name": name, "summary": summary}
                )

            result = await execute_tool(
                name,
                tool_input,
                settings,
                dispatch_launcher=dispatch_launcher,
            )

            if name == "mango_search":
                last_search_hits = _parse_search_results(result)
                if (
                    user_open_intent
                    and not open_confirmed
                    and dispatch_launcher is not None
                ):
                    open_confirmed = await _auto_open_best_hit(
                        last_search_hits,
                        settings,
                        dispatch_launcher,
                        on_tool_event=on_tool_event,
                    )

            if name == "mango_open_title":
                open_confirmed = _tool_open_confirmed(result)

            if on_tool_event is not None:
                await on_tool_event(
                    {"type": "tool", "phase": "done", "name": name, "summary": summary, "result": result}
                )

            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result,
                }
            )

        transcript.append({"role": "user", "content": tool_result_blocks})

    raise RuntimeError("voice agent exceeded tool rounds without a final reply")


def _load_tools(settings: OrchestratorSettings) -> list[dict[str, Any]]:
    catalog = catalog_tools.catalog_tools_for_llm(settings)
    manifest = catalog_tools.fetch_tool_manifest(settings)
    tools = manifest.get("tools")
    launcher_defs: list[dict[str, Any]] = []
    if isinstance(tools, list):
        for tool in tools:
            if not isinstance(tool, dict) or tool.get("layer") != "launcher":
                continue
            name = tool.get("name")
            description = tool.get("description")
            input_schema = tool.get("input_schema")
            if not isinstance(name, str) or not isinstance(description, str):
                continue
            if not isinstance(input_schema, dict):
                continue
            launcher_defs.append(
                {
                    "name": name,
                    "description": description,
                    "input_schema": input_schema,
                }
            )
    return [*catalog, *launcher_defs]


def _serialize_block(block: Any) -> dict[str, Any]:
    block_type = getattr(block, "type", None)
    if block_type == "text":
        return {"type": "text", "text": getattr(block, "text", "")}
    if block_type == "tool_use":
        return {
            "type": "tool_use",
            "id": getattr(block, "id", ""),
            "name": getattr(block, "name", ""),
            "input": getattr(block, "input", {}),
        }
    return {"type": str(block_type or "unknown")}


def _tool_open_confirmed(result: str) -> bool:
    try:
        import json

        payload = json.loads(result)
    except json.JSONDecodeError:
        return False
    return payload.get("ok") is True and isinstance(payload.get("tv_seq"), int)


def _guard_open_claims(reply: str, open_confirmed: bool) -> str:
    """Do not claim the TV opened unless mango_open_title confirmed tv_seq."""
    if open_confirmed:
        return reply
    lowered = reply.lower()
    claims_open = any(
        phrase in lowered
        for phrase in (
            "press b",
            "opened",
            "opening",
            "open kar",
            "khol diya",
            "khol raha",
            "khol deta",
            "detail page",
            "play kar",
            "mil gaya",
            "found it",
            "found ",
            "dikha diya",
            "tv pe",
        )
    )
    if not claims_open:
        return reply
    return (
        "TV pe abhi title open nahi hua — ek baar phir try karte hain. "
        "Agar phir bhi home screen pe ho, ⌂ dabao aur dubara bolo."
    )


def _last_user_text(messages: list[dict[str, str]]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            content = message.get("content")
            if isinstance(content, str):
                return content
    return ""


def _parse_search_results(result: str) -> list[dict[str, Any]]:
    try:
        import json

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


def _pick_auto_open_hit(hits: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not hits:
        return None
    scored: list[tuple[int, dict[str, Any]]] = []
    for hit in hits:
        score = hit.get("score")
        score_value = int(score) if isinstance(score, (int, float)) else 0
        if isinstance(hit.get("id"), str) and isinstance(hit.get("title"), str):
            scored.append((score_value, hit))
    if not scored:
        return None
    scored.sort(key=lambda pair: pair[0], reverse=True)
    top_score, top_hit = scored[0]
    if top_score >= 92:
        return top_hit
    if len(scored) == 1 and top_score >= 78:
        return top_hit
    if len(scored) > 1:
        second_score = scored[1][0]
        if top_score >= 85 and top_score - second_score >= 12:
            return top_hit
    return None


def _open_tool_input_from_hit(hit: dict[str, Any]) -> dict[str, Any]:
    content_type = hit.get("type")
    content_id = hit.get("id")
    title = hit.get("title")
    if not isinstance(content_type, str) or not isinstance(content_id, str):
        raise ValueError("search hit missing type/id")
    if not isinstance(title, str) or not title.strip():
        title = content_id
    payload: dict[str, Any] = {
        "type": content_type,
        "id": content_id,
        "title": title.strip(),
    }
    tab = hit.get("tab")
    if isinstance(tab, str) and tab.strip():
        payload["tab"] = tab.strip()
    poster = hit.get("poster")
    if isinstance(poster, str) and poster.strip():
        payload["poster"] = poster.strip()
    return payload


async def _auto_open_best_hit(
    hits: list[dict[str, Any]],
    settings: OrchestratorSettings,
    dispatch_launcher: LauncherDispatch,
    *,
    on_tool_event: ToolEventCallback | None = None,
) -> bool:
    hit = _pick_auto_open_hit(hits)
    if hit is None:
        return False
    try:
        tool_input = _open_tool_input_from_hit(hit)
    except ValueError:
        return False
    summary = tool_summary("mango_open_title", tool_input)
    if on_tool_event is not None:
        await on_tool_event(
            {"type": "tool", "phase": "start", "name": "mango_open_title", "summary": summary}
        )
    result = await execute_tool(
        "mango_open_title",
        tool_input,
        settings,
        dispatch_launcher=dispatch_launcher,
    )
    if on_tool_event is not None:
        await on_tool_event(
            {
                "type": "tool",
                "phase": "done",
                "name": "mango_open_title",
                "summary": summary,
                "result": result,
            }
        )
    return _tool_open_confirmed(result)


def _default_open_reply(hits: list[dict[str, Any]]) -> str:
    hit = _pick_auto_open_hit(hits) or (hits[0] if hits else None)
    title = hit.get("title") if isinstance(hit, dict) else "title"
    if not isinstance(title, str) or not title.strip():
        title = "title"
    return f"{title.strip()} detail pe khula — B dabao play ke liye."


def _mock_reply(
    messages: list[dict[str, str]],
    *,
    on_delta: DeltaCallback | None = None,
) -> str:
    last_user = next(
        (m.get("content") or "" for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    reply = f"I heard: {last_user}"
    if on_delta is not None:
        on_delta(reply)
    return reply

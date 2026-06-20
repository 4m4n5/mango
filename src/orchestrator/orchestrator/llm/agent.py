"""Tool-calling voice agent — Anthropic tools API + catalog/launcher dispatch."""

from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

from orchestrator.config import OrchestratorSettings
from orchestrator.llm.open_intent import (
    extract_title_search_query,
    is_followup_pick_only,
    user_wants_title_navigation,
)
from orchestrator.llm.provider import DeltaCallback, _clean_reply, _read_api_key
from orchestrator.session import VoiceBrowseContext
from orchestrator.tools import catalog as catalog_tools
from orchestrator.tools.runner import execute_tool, tool_summary
from orchestrator.tools.voice_nav import (
    hit_matches_sequel_query,
    hit_to_open_input,
    pick_auto_open_hit,
    pick_hit_from_utterance,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are mango's TV librarian — warm, knowledgeable couch assistant for a mango TV box. "
    "Users speak Hinglish, Hindi, or English — reply in the same mix (Roman script is fine). "
    "You know the verified playable library via tools; use world knowledge about films and shows too. "
    "NAVIGATION (seamless — never ask the user to press ⌂ home or go back manually): "
    "mango_open_title works from home, detail, or settings — it replaces the current title in place. "
    "To switch titles: mango_search (or use recent results) → mango_open_title. "
    "For 'the second one' / 'doosra' after you listed options, mango_open_title using that hit. "
    "mango_navigate back/home only when the user explicitly wants to leave detail. "
    "For recommendations: mango_read_librarian_notes, then mango_library_overview or mango_library_browse. "
    "OPEN FLOW (specific title now): mango_search → mango_open_title with type,id,title,tab,poster. "
    "If not in library: mango_search_external (queue_missing=false) → list 2–4 options → "
    "mango_open_title when the user picks or names one. "
    "QUEUE FLOW (save for later, no TV change): mango_search_external with queue_missing=true only when "
    "the user wants verify-pool ingest — never open detail in the same turn as queue-only. "
    "After useful recommendation sessions, save concise taste/themes in mango_update_librarian_notes. "
    "NEVER start, pause, or resume playback — user presses B on the remote. "
    "CRITICAL: only say you opened a title if mango_open_title returned ok:true with tv_seq. "
    "If tv_seq is missing or ok:false, say the TV did not update — do NOT tell them to press ⌂ home. "
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
    voice_browse: VoiceBrowseContext | None = None,
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

    browse = voice_browse or VoiceBrowseContext()
    client = Anthropic(api_key=api_key)
    transcript = messages
    open_confirmed = False
    last_open_title = ""
    user_text = _last_user_text(messages)
    nav_intent = user_wants_title_navigation(user_text)
    fast_path_only = False

    if nav_intent and dispatch_launcher is not None:
        if is_followup_pick_only(user_text):
            contextual = pick_hit_from_utterance(user_text, browse.all_hits())
            if contextual is not None:
                open_confirmed, last_open_title = await _open_hit(
                    contextual,
                    settings,
                    dispatch_launcher,
                    on_tool_event=on_tool_event,
                )
        else:
            open_confirmed, last_open_title, fast_path_only = await _fast_path_open(
                user_text,
                settings,
                browse,
                dispatch_launcher,
                on_tool_event=on_tool_event,
            )

    if open_confirmed and nav_intent and fast_path_only:
        reply = _default_open_reply(last_open_title)
        reply = _guard_open_claims(reply, open_confirmed)
        if on_delta is not None:
            on_delta(reply)
        return reply

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
                nav_intent
                and not open_confirmed
                and is_followup_pick_only(user_text)
                and browse.all_hits()
                and dispatch_launcher
            ):
                open_confirmed, last_open_title = await _open_best_from_hits(
                    browse.all_hits(),
                    settings,
                    dispatch_launcher,
                    user_text=user_text,
                    on_tool_event=on_tool_event,
                )
            reply = _clean_reply(" ".join(text_parts))
            if open_confirmed and nav_intent and not reply.strip():
                reply = _default_open_reply(last_open_title)
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
                hits = _parse_search_results(result)
                browse.remember_library(hits)
                if nav_intent and not open_confirmed and dispatch_launcher is not None:
                    open_confirmed, last_open_title = await _open_best_from_hits(
                        hits,
                        settings,
                        dispatch_launcher,
                        user_text=user_text,
                        on_tool_event=on_tool_event,
                    )

            if name == "mango_search_external":
                hits = _parse_search_results(result)
                browse.remember_external(hits)
                if nav_intent and not open_confirmed and dispatch_launcher is not None:
                    open_confirmed, last_open_title = await _open_best_from_hits(
                        hits,
                        settings,
                        dispatch_launcher,
                        user_text=user_text,
                        on_tool_event=on_tool_event,
                    )

            if name == "mango_open_title":
                open_confirmed = _tool_open_confirmed(result)
                if open_confirmed:
                    title = tool_input.get("title")
                    if isinstance(title, str) and title.strip():
                        last_open_title = title.strip()

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
            "khol dunga",
            "khol deti",
            "detail page",
            "play kar",
            "mil gaya",
            "found it",
            "found ",
            "dikha diya",
            "tv pe",
            "going to open",
            "i'll open",
            "let me open",
            "switching to",
            "switch kar",
        )
    )
    if not claims_open:
        return reply
    return (
        "TV pe title switch nahi hua — ek baar aur try karte hain. "
        "Tum detail ya home pe ho, dono theek hain — bas dubara bolo kaunsa title."
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


async def _fast_path_open(
    user_text: str,
    settings: OrchestratorSettings,
    browse: VoiceBrowseContext,
    dispatch_launcher: LauncherDispatch,
    *,
    on_tool_event: ToolEventCallback | None = None,
) -> tuple[bool, str, bool]:
    """Search library then open — before LLM, for fresh title/switch requests."""
    query = extract_title_search_query(user_text) or user_text.strip()
    if len(query) < 2:
        return False, "", False

    if on_tool_event is not None:
        await on_tool_event(
            {
                "type": "tool",
                "phase": "start",
                "name": "mango_search",
                "summary": tool_summary("mango_search", {"query": query}),
            }
        )
    search_json = await execute_tool(
        "mango_search",
        {"query": query, "limit": 5},
        settings,
    )
    hits = _parse_search_results(search_json)
    browse.remember_library(hits)
    if on_tool_event is not None:
        await on_tool_event(
            {
                "type": "tool",
                "phase": "done",
                "name": "mango_search",
                "summary": tool_summary("mango_search", {"query": query}),
                "result": search_json,
            }
        )

    hit = pick_hit_from_utterance(user_text, hits) or pick_auto_open_hit(hits, query=query)
    need_external = hit is None or not hit_matches_sequel_query(user_text, hit)
    if need_external:
        external_hits = await _fast_path_external_search(
            query,
            settings,
            browse,
            on_tool_event=on_tool_event,
        )
        if external_hits:
            hit = pick_hit_from_utterance(user_text, external_hits) or pick_auto_open_hit(
                external_hits,
                query=query,
            )

    if hit is None:
        logger.info(
            "voice fast_path miss query=%r library_hits=%d",
            query,
            len(hits),
        )
        return False, "", False

    opened, title = await _open_hit(
        hit,
        settings,
        dispatch_launcher,
        on_tool_event=on_tool_event,
    )
    return opened, title, opened


async def _fast_path_external_search(
    query: str,
    settings: OrchestratorSettings,
    browse: VoiceBrowseContext,
    *,
    on_tool_event: ToolEventCallback | None = None,
) -> list[dict[str, Any]]:
    if on_tool_event is not None:
        await on_tool_event(
            {
                "type": "tool",
                "phase": "start",
                "name": "mango_search_external",
                "summary": tool_summary("mango_search_external", {"query": query}),
            }
        )
    search_json = await execute_tool(
        "mango_search_external",
        {"query": query, "limit": 8, "queue_missing": False},
        settings,
    )
    hits = _parse_search_results(search_json)
    browse.remember_external(hits)
    if on_tool_event is not None:
        await on_tool_event(
            {
                "type": "tool",
                "phase": "done",
                "name": "mango_search_external",
                "summary": tool_summary("mango_search_external", {"query": query}),
                "result": search_json,
            }
        )
    return hits


async def _open_hit(
    hit: dict[str, Any],
    settings: OrchestratorSettings,
    dispatch_launcher: LauncherDispatch,
    *,
    on_tool_event: ToolEventCallback | None = None,
) -> tuple[bool, str]:
    try:
        tool_input = hit_to_open_input(hit)
    except ValueError:
        return False, ""
    title = str(tool_input.get("title", ""))
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
    return _tool_open_confirmed(result), title


async def _open_best_from_hits(
    hits: list[dict[str, Any]],
    settings: OrchestratorSettings,
    dispatch_launcher: LauncherDispatch,
    *,
    user_text: str = "",
    on_tool_event: ToolEventCallback | None = None,
) -> tuple[bool, str]:
    query = extract_title_search_query(user_text) or user_text.strip() or None
    hit = pick_auto_open_hit(hits, query=query)
    if hit is None:
        return False, ""
    return await _open_hit(hit, settings, dispatch_launcher, on_tool_event=on_tool_event)


def _default_open_reply(title: str) -> str:
    name = title.strip() if title.strip() else "title"
    return f"{name} detail pe khula — B dabao play ke liye."


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

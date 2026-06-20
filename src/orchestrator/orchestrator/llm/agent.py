"""Tool-calling voice agent — Anthropic tools API + catalog/launcher dispatch."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any

from orchestrator.config import OrchestratorSettings
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
            reply = _clean_reply(" ".join(text_parts))
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

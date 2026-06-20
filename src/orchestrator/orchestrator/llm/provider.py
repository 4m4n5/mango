from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path

from orchestrator.config import OrchestratorSettings

SYSTEM_PROMPT = (
    "You are mango, a concise TV assistant for couch voice chat. "
    "Users often speak Hinglish (Hindi and English mixed), Hindi, or English. "
    "Understand all three; reply in the same language mix the user used. "
    "For Hinglish input, reply in natural Hinglish (Roman script is fine). "
    "When voice tools are enabled, use them for playback and navigation. "
    "Reply in one short spoken sentence when possible."
)

DeltaCallback = Callable[[str], None]


def generate_reply(
    messages: list[dict[str, str]],
    settings: OrchestratorSettings,
    *,
    on_delta: DeltaCallback | None = None,
) -> str:
    if os.environ.get("MANGO_LLM_MOCK") == "1":
        last_user = next(
            (m.get("content") or m.get("text") or "" for m in reversed(messages) if m["role"] == "user"),
            "",
        )
        reply = f"I heard: {last_user}"
        if on_delta is not None:
            on_delta(reply)
        return reply
    provider = settings.llm_provider.lower()
    api_key = _read_api_key(settings, provider)
    if provider == "anthropic":
        return _anthropic_reply(messages, settings, api_key, on_delta=on_delta)
    if provider == "openai":
        return _openai_reply(messages, settings, api_key, on_delta=on_delta)
    raise RuntimeError(f"unsupported LLM provider: {settings.llm_provider}")


def _read_api_key(settings: OrchestratorSettings, provider: str) -> str:
    env_name = "ANTHROPIC_API_KEY" if provider == "anthropic" else "OPENAI_API_KEY"
    env_value = os.environ.get(env_name)
    if env_value:
        return env_value.strip()
    if settings.llm_api_key_file:
        key_path = Path(settings.llm_api_key_file).expanduser()
        if key_path.is_file():
            return key_path.read_text(encoding="utf-8").strip()
    raise RuntimeError(f"missing {provider} API key file")


def _anthropic_reply(
    messages: list[dict[str, str]],
    settings: OrchestratorSettings,
    api_key: str,
    *,
    on_delta: DeltaCallback | None,
) -> str:
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    if on_delta is None:
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=settings.llm_max_tokens,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        return _clean_reply(_anthropic_blocks_to_text(response.content))

    parts: list[str] = []
    with client.messages.stream(
        model=settings.llm_model,
        max_tokens=settings.llm_max_tokens,
        system=SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        for event in stream:
            if event.type != "content_block_delta":
                continue
            delta = getattr(event.delta, "text", None)
            if not isinstance(delta, str) or not delta:
                continue
            parts.append(delta)
            on_delta("".join(parts))
    return _clean_reply("".join(parts))


def _openai_reply(
    messages: list[dict[str, str]],
    settings: OrchestratorSettings,
    api_key: str,
    *,
    on_delta: DeltaCallback | None,
) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    payload = [{"role": "system", "content": SYSTEM_PROMPT}] + [
        {"role": msg["role"], "content": msg["content"]} for msg in messages
    ]
    if on_delta is None:
        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=payload,
            max_tokens=settings.llm_max_tokens,
        )
        content = response.choices[0].message.content or ""
        return _clean_reply(content)

    parts: list[str] = []
    stream = client.chat.completions.create(
        model=settings.llm_model,
        messages=payload,
        max_tokens=settings.llm_max_tokens,
        stream=True,
    )
    for chunk in stream:
        choice = chunk.choices[0] if chunk.choices else None
        if choice is None:
            continue
        delta = choice.delta.content
        if not isinstance(delta, str) or not delta:
            continue
        parts.append(delta)
        on_delta("".join(parts))
    return _clean_reply("".join(parts))


def _anthropic_blocks_to_text(blocks: object) -> str:
    text_parts: list[str] = []
    for block in blocks:  # type: ignore[union-attr]
        text = getattr(block, "text", None)
        if isinstance(text, str):
            text_parts.append(text)
    return " ".join(text_parts)


def _clean_reply(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        raise RuntimeError("LLM returned an empty reply")
    return cleaned

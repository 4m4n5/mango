from __future__ import annotations

import os
from pathlib import Path

from orchestrator.config import OrchestratorSettings

SYSTEM_PROMPT = (
    "You are mango, a concise TV assistant for couch voice chat. "
    "Users often speak Hinglish (Hindi and English mixed), Hindi, or English. "
    "Understand all three; reply in the same language mix the user used. "
    "For Hinglish input, reply in natural Hinglish (Roman script is fine). "
    "Phase 2 has no media tools yet, so do not claim to control playback. "
    "Reply in one or two short spoken sentences."
)


def generate_reply(messages: list[dict[str, str]], settings: OrchestratorSettings) -> str:
    if os.environ.get("MANGO_LLM_MOCK") == "1":
        last_user = next(
            (m.get("content") or m.get("text") or "" for m in reversed(messages) if m["role"] == "user"),
            "",
        )
        return f"I heard: {last_user}"
    provider = settings.llm_provider.lower()
    api_key = _read_api_key(settings, provider)
    if provider == "anthropic":
        return _anthropic_reply(messages, settings.llm_model, api_key)
    if provider == "openai":
        return _openai_reply(messages, settings.llm_model, api_key)
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


def _anthropic_reply(messages: list[dict[str, str]], model: str, api_key: str) -> str:
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=220,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    text_parts: list[str] = []
    for block in response.content:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            text_parts.append(text)
    return _clean_reply(" ".join(text_parts))


def _openai_reply(messages: list[dict[str, str]], model: str, api_key: str) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}]
        + [{"role": msg["role"], "content": msg["content"]} for msg in messages],
        max_tokens=220,
    )
    content = response.choices[0].message.content or ""
    return _clean_reply(content)


def _clean_reply(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        raise RuntimeError("LLM returned an empty reply")
    return cleaned

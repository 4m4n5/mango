"""Couch-safe error text for phone companion and TV HUD — never leak upstream secrets."""

from __future__ import annotations

import re

# Orchestrator-authored messages safe to show verbatim.
_SAFE_EXACT = frozenset(
    {
        "voice is busy",
        "voice is already processing",
        "push-to-talk is not active",
        "text is empty",
        "text is too long",
        "listening timed out",
    }
)

_SENSITIVE_RE = re.compile(
    r"(?i)"
    r"(anthropic|deepgram|openai|api[_-]?key|sk-ant-|Bearer\s|"
    r"rate[-\s]*limit|429|401|403|"
    r"traceback|file \"/|exception:|"
    r"HTTP/\d|HTTP\s+\d{3}|"
    r"ECONN|ETIMEDOUT|socket hang up)"
)

_LLM_EMPTY_RE = re.compile(r"LLM returned an empty reply", re.IGNORECASE)

_DEFAULT = "Something went wrong — try again in a moment."


def couch_safe_error_message(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return _DEFAULT
    lowered = text.lower()
    if lowered in _SAFE_EXACT:
        return text
    if _LLM_EMPTY_RE.search(text):
        return "Mango didn't have a reply — try again."
    if _SENSITIVE_RE.search(text):
        return _DEFAULT
    if len(text) > 240:
        return _DEFAULT
    return text

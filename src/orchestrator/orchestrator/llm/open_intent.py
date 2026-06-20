"""Detect when the user wants a title opened on TV (detail page, not playback)."""

from __future__ import annotations

import re

_OPEN_VERBS = re.compile(
    r"\b("
    r"open|kholo|khol|dikhao|dikha|dikha\s*do|show|play|chalao|chala|chala\s*do|"
    r"lagao|laga\s*do|start|dekhna|dekho|pull\s*up|bring\s*up"
    r")\b",
    re.IGNORECASE,
)
_RECOMMEND_ONLY = re.compile(
    r"\b(recommend|suggest|suggestion|kya\s+dekhu|kya\s+dekhe|what\s+should|"
    r"mood|vibe|bored|kuch\s+accha|options|list)\b",
    re.IGNORECASE,
)


def user_wants_open_detail(text: str) -> bool:
    """True when the utterance is asking to surface a specific title on TV."""
    normalized = text.strip()
    if not normalized:
        return False
    if not _OPEN_VERBS.search(normalized):
        return False
    if _RECOMMEND_ONLY.search(normalized) and not re.search(
        r"\b(open|kholo|khol|dikhao|play|chalao|show)\b",
        normalized,
        re.IGNORECASE,
    ):
        return False
    return True

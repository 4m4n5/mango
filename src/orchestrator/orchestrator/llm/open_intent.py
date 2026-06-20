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
_ORDINAL_PICK = re.compile(
    r"\b("
    r"first|second|third|fourth|one|two|three|four|"
    r"pehla|pehle|pehli|doosra|doosre|dusra|teesra|teesri|chautha|"
    r"option|number|#\d|wala|wali|wale"
    r")\b",
    re.IGNORECASE,
)
_SWITCH = re.compile(
    r"\b("
    r"instead|instead\s+of|uski\s+jagah|change|switch|different|next\s+one|"
    r"not\s+this|kuch\s+aur|dusra\s+title|doosra\s+title"
    r")\b",
    re.IGNORECASE,
)
_FOLLOWUP = re.compile(
    r"\b(that\s+one|this\s+one|ye\s+wala|ye\s+wali|wahi|vahi|ye\s+hi|the\s+one)\b",
    re.IGNORECASE,
)
_OPEN_VERBS_STRIP = re.compile(
    r"^\s*(?:"
    r"open|kholo|khol|dikhao|dikha(?:\s*do)?|show|play|chalao|chala(?:\s*do)?|"
    r"lagao|laga(?:\s*do)?|start|dekhna|dekho|pull\s*up|bring\s*up"
    r")\s+",
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


def user_wants_title_navigation(text: str) -> bool:
    """Open/switch/pick intent — includes ordinals and follow-ups without 'open'."""
    normalized = text.strip()
    if not normalized:
        return False
    if user_wants_open_detail(normalized):
        return True
    if _ORDINAL_PICK.search(normalized):
        return True
    if _SWITCH.search(normalized):
        return True
    if _FOLLOWUP.search(normalized):
        return True
    return False


_QUESTION = re.compile(
    r"\b(what|why|how|when|who|kya|kaise|kyun|tell\s+me\s+about|about)\b",
    re.IGNORECASE,
)


def extract_title_search_query(text: str) -> str | None:
    """Strip open verbs and return a catalog search query, if any."""
    normalized = text.strip()
    if not normalized:
        return None
    stripped = _OPEN_VERBS_STRIP.sub("", normalized).strip(" .,!?:;")
    if len(stripped) < 2:
        return None
    if _RECOMMEND_ONLY.search(stripped) and not _OPEN_VERBS.search(normalized):
        return None
    return stripped


def is_followup_pick_only(text: str) -> bool:
    """Utterance picks from a prior list — not a fresh title name."""
    normalized = text.strip()
    if not normalized:
        return False
    if _ORDINAL_PICK.search(normalized):
        return True
    if _FOLLOWUP.search(normalized):
        return True
    if _SWITCH.search(normalized) and not extract_title_search_query(normalized):
        return True
    return False


def utterance_is_title_pick_only(text: str) -> bool:
    """Bare title name or list pick — not a recommendation question."""
    normalized = text.strip()
    if not normalized or _QUESTION.search(normalized):
        return False
    if user_wants_title_navigation(normalized):
        return True
    if _RECOMMEND_ONLY.search(normalized):
        return False
    # Short utterance that names a title after the agent listed options.
    return len(normalized.split()) <= 6
